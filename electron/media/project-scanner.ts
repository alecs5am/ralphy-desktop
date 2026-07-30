import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { resolveProjectPath, validateLibraryRoot } from "./catalog";
import type {
  GenerationAttribution,
  GenerationLedgerResult,
  MediaEntity,
  MediaItem,
  MediaKind,
  ProjectScanProgress,
  ProjectScanRequest,
  ProjectScanResult,
} from "./types";

const DEFAULT_LEDGER_LINE_BYTES = 256 * 1024;
const DEFAULT_LEDGER_BYTES = 64 * 1024 * 1024;
const DEFAULT_LEDGER_ENTRIES = 100_000;
const LEDGER_CACHE_SIZE = 8;

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mkv", ".mov", ".mp4", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const LIFECYCLE_FILES = new Set([
  "asset-manifest.json",
  "brief.md",
  "eval.json",
  "production-contract.json",
  "production-plan.json",
  "production_plan.md",
  "prompts.json",
  "scenario.json",
  "scorecard.json",
  "storyboard.md",
]);

interface LedgerCacheEntry {
  size: number;
  mtimeMs: number;
  maxLineBytes: number;
  maxBytes: number;
  maxEntries: number;
  result: GenerationLedgerResult;
  byPath: Map<string, GenerationAttribution>;
}

const ledgerCache = new Map<string, LedgerCacheEntry>();

export class ScanCancelledError extends Error {
  constructor() {
    super("Project scan cancelled");
    this.name = "ScanCancelledError";
  }
}

export interface ProjectScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ProjectScanProgress) => void;
  maxLedgerLineBytes?: number;
  maxLedgerBytes?: number;
  maxLedgerEntries?: number;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScanCancelledError();
}

function toProjectPath(path: string): string {
  return path.split(sep).join("/");
}

function mediaKind(extension: string): MediaKind {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (extension === ".pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "other";
}

export function classifyRalphyEntity(projectRelativePath: string): MediaEntity {
  const normalized = projectRelativePath.toLowerCase();
  const name = basename(normalized);
  if (normalized.startsWith("render/") && /^final(?:[._-]|$)/.test(name)) {
    return "final-render";
  }
  if (
    normalized.startsWith("artifacts/refs/")
    || normalized.startsWith("refs/")
    || normalized.startsWith("references/")
  ) {
    return "reference";
  }
  if (normalized.startsWith("artifacts/") || normalized.startsWith("selected/")) {
    return "generated-artifact";
  }
  if (normalized.startsWith("units/")) return "unit-asset";
  if (
    LIFECYCLE_FILES.has(name)
    || normalized.startsWith("logs/")
    || normalized.startsWith("postmortem/")
  ) {
    return "lifecycle-document";
  }
  if (
    name === "index.html"
    || normalized.startsWith("scripts/")
    || normalized.startsWith("src/")
    || normalized.startsWith("public/")
    || normalized.startsWith("render/")
  ) {
    return "production-file";
  }
  return "other-project-file";
}

function stableMediaId(
  workspaceId: string,
  projectId: string,
  projectRelativePath: string,
): string {
  return createHash("sha256")
    .update(workspaceId)
    .update("\0")
    .update(projectId)
    .update("\0")
    .update(projectRelativePath)
    .digest("hex")
    .slice(0, 24);
}

function finiteCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function ledgerAttribution(row: Record<string, unknown>): GenerationAttribution {
  const input = row.input !== null && typeof row.input === "object"
    ? row.input as Record<string, unknown>
    : {};
  const endpoint = typeof row.endpoint === "string" ? row.endpoint : "unknown";
  const kind = typeof row.kind === "string" ? row.kind : endpoint;
  return {
    provider: typeof row.provider === "string" ? row.provider : "other",
    model: typeof row.model === "string" ? row.model : endpoint,
    operation: typeof row.task === "string" ? row.task : kind,
    timestamp: typeof row.timestamp === "string"
      ? row.timestamp
      : new Date(0).toISOString(),
    costUsd: finiteCost(row.cost_usd ?? row.costUsd),
    slot: typeof input.slot === "string"
      ? input.slot
      : typeof row.slot === "string" ? row.slot : null,
  };
}

function localOutput(row: Record<string, unknown>): string | null {
  if (row.output === null || typeof row.output !== "object") return null;
  const local = (row.output as Record<string, unknown>).local;
  return typeof local === "string" && local.trim() ? local : null;
}

function relativeLedgerOutput(
  local: string,
  rootPath: string,
  projectPath: string,
): string | null {
  let absolute: string;
  if (isAbsolute(local)) {
    absolute = resolve(local);
  } else if (local === ".ralphy" || local.startsWith(`.ralphy${sep}`) || local.startsWith(".ralphy/")) {
    absolute = join(rootPath, local.replace(/^\.ralphy[\\/]*?/, ""));
  } else if (local.startsWith("workspaces/") || local.startsWith(`workspaces${sep}`)) {
    absolute = join(rootPath, local);
  } else {
    absolute = join(projectPath, local);
  }
  const rel = relative(projectPath, absolute);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return toProjectPath(rel);
}

function cacheLedger(path: string, entry: LedgerCacheEntry): void {
  ledgerCache.delete(path);
  ledgerCache.set(path, entry);
  while (ledgerCache.size > LEDGER_CACHE_SIZE) {
    const oldest = ledgerCache.keys().next().value as string | undefined;
    if (!oldest) break;
    ledgerCache.delete(oldest);
  }
}

async function readGenerationLedger(
  rootPath: string,
  projectPath: string,
  maxLineBytes: number,
  maxBytes: number,
  maxEntries: number,
  signal?: AbortSignal,
): Promise<{ result: GenerationLedgerResult; byPath: Map<string, GenerationAttribution> }> {
  const path = join(projectPath, "logs", "generations.jsonl");
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    return {
      result: {
        entries: [],
        totalCostUsd: 0,
        malformedLineCount: 0,
        oversizedLineCount: 0,
        truncated: false,
      },
      byPath: new Map(),
    };
  }
  const cached = ledgerCache.get(path);
  if (
    cached
    && cached.size === info.size
    && cached.mtimeMs === info.mtimeMs
    && cached.maxLineBytes === maxLineBytes
    && cached.maxBytes === maxBytes
    && cached.maxEntries === maxEntries
  ) {
    ledgerCache.delete(path);
    ledgerCache.set(path, cached);
    return { result: cached.result, byPath: cached.byPath };
  }

  const entries: GenerationAttribution[] = [];
  const byPath = new Map<string, GenerationAttribution>();
  let totalCostUsd = 0;
  let malformedLineCount = 0;
  let oversizedLineCount = 0;
  let pending = "";
  let pendingBytes = 0;
  let discarding = false;
  let linesRead = 0;
  let rowLimitReached = false;
  const decoder = new StringDecoder("utf8");

  const finishLine = (): boolean => {
    linesRead += 1;
    if (linesRead < maxEntries) return true;
    rowLimitReached = true;
    return false;
  };

  const consume = (text: string): boolean => {
    const parts = text.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const lineEnded = index < parts.length - 1;
      if (discarding) {
        if (lineEnded) {
          discarding = false;
          if (!finishLine()) return false;
        }
        continue;
      }

      const partBytes = Buffer.byteLength(part);
      if (pendingBytes + partBytes > maxLineBytes) {
        oversizedLineCount += 1;
        pending = "";
        pendingBytes = 0;
        discarding = !lineEnded;
        if (lineEnded && !finishLine()) return false;
        continue;
      }

      pending += part;
      pendingBytes += partBytes;
      if (!lineEnded) continue;
      if (pending.trim()) {
        try {
          const parsed = JSON.parse(pending) as unknown;
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            malformedLineCount += 1;
          } else {
            const row = parsed as Record<string, unknown>;
            const attribution = ledgerAttribution(row);
            entries.push(attribution);
            if (attribution.costUsd !== null) {
              const nextTotal = totalCostUsd + attribution.costUsd;
              if (Number.isFinite(nextTotal)) totalCostUsd = nextTotal;
            }
            const local = localOutput(row);
            const relativeOutput = local
              ? relativeLedgerOutput(local, rootPath, projectPath)
              : null;
            if (relativeOutput) byPath.set(relativeOutput, attribution);
          }
        } catch {
          malformedLineCount += 1;
        }
      }
      pending = "";
      pendingBytes = 0;
      if (!finishLine()) return false;
    }
    return true;
  };

  const byteLimitReached = info.size > maxBytes;
  const stream = createReadStream(path, { end: maxBytes - 1 });
  try {
    for await (const chunk of stream) {
      throwIfCancelled(signal);
      if (!consume(decoder.write(chunk as Buffer))) break;
    }
    if (!rowLimitReached && !byteLimitReached) {
      consume(decoder.end());
      if (!discarding && pending.trim()) consume("\n");
    }
  } finally {
    stream.destroy();
  }

  const result = {
    entries,
    totalCostUsd,
    malformedLineCount,
    oversizedLineCount,
    truncated: byteLimitReached || rowLimitReached,
  };
  cacheLedger(path, {
    size: info.size,
    mtimeMs: info.mtimeMs,
    maxLineBytes,
    maxBytes,
    maxEntries,
    result,
    byPath,
  });
  return { result, byPath };
}

export async function scanProject(
  request: ProjectScanRequest,
  options: ProjectScanOptions = {},
): Promise<ProjectScanResult> {
  const rootPath = await validateLibraryRoot(request.rootPath);
  const projectPath = await resolveProjectPath(
    request.rootPath,
    request.workspaceId,
    request.projectId,
  );
  const maxLedgerLineBytes = Math.max(
    64,
    Math.floor(options.maxLedgerLineBytes ?? DEFAULT_LEDGER_LINE_BYTES),
  );
  const maxLedgerBytes = Math.max(
    64,
    Math.floor(options.maxLedgerBytes ?? DEFAULT_LEDGER_BYTES),
  );
  const maxLedgerEntries = Math.max(
    1,
    Math.floor(options.maxLedgerEntries ?? DEFAULT_LEDGER_ENTRIES),
  );
  const { result: ledger, byPath } = await readGenerationLedger(
    rootPath,
    projectPath,
    maxLedgerLineBytes,
    maxLedgerBytes,
    maxLedgerEntries,
    options.signal,
  );
  const items: MediaItem[] = [];
  const pendingDirectories = [projectPath];
  let filesScanned = 0;
  let bytesScanned = 0;

  while (pendingDirectories.length > 0) {
    throwIfCancelled(options.signal);
    const directory = pendingDirectories.pop();
    if (!directory) break;
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      throwIfCancelled(options.signal);
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await lstat(absolutePath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const projectRelativePath = toProjectPath(relative(projectPath, absolutePath));
      const extension = extname(entry.name).toLowerCase();
      filesScanned += 1;
      bytesScanned += info.size;
      items.push({
        id: stableMediaId(request.workspaceId, request.projectId, projectRelativePath),
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        name: entry.name,
        absolutePath,
        projectRelativePath,
        entity: classifyRalphyEntity(projectRelativePath),
        kind: mediaKind(extension),
        extension,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        generation: byPath.get(projectRelativePath) ?? null,
      });
      options.onProgress?.({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        generation: request.generation,
        filesScanned,
        bytesScanned,
      });
      throwIfCancelled(options.signal);
    }
  }

  items.sort((left, right) => left.projectRelativePath.localeCompare(right.projectRelativePath));
  return {
    rootPath,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    generation: request.generation,
    items,
    ledger,
    completedAt: new Date().toISOString(),
  };
}
