import {
  lstat,
  open,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  CatalogProgress,
  CatalogResult,
  ProjectSummary,
  TextReadResult,
  TrashResult,
  WorkspaceSummary,
} from "./types";

const JSON_LIMIT_BYTES = 1024 * 1024;
const TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type JsonObject = Record<string, unknown>;

export class InvalidLibraryRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLibraryRootError";
  }
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoTime(value: number): string {
  return new Date(value || 0).toISOString();
}

async function safeStat(path: string): Promise<Stats | null> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? null : info;
  } catch {
    return null;
  }
}

async function directEntries(path: string): Promise<Dirent<string>[]> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function directDirectories(path: string): Promise<string[]> {
  const entries = await directEntries(path);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

async function directCount(path: string): Promise<number> {
  return (await directEntries(path)).filter((entry) => !entry.isSymbolicLink()).length;
}

async function directFinalCount(projectPath: string): Promise<number> {
  const entries = await directEntries(join(projectPath, "render"));
  return entries.filter((entry) => entry.isFile() && /^final(?:[._-]|$)/i.test(entry.name)).length;
}

async function newestMtime(paths: string[]): Promise<number> {
  let newest = 0;
  for (const path of paths) {
    const info = await safeStat(path);
    if (info && info.mtimeMs > newest) newest = info.mtimeMs;
  }
  return newest;
}

async function hasFile(path: string): Promise<boolean> {
  const info = await safeStat(path);
  return info?.isFile() ?? false;
}

function projectIdentity(workspaceId: string, projectId: string): string {
  return `${workspaceId}/${projectId}`;
}

function registryProjects(registry: unknown): Record<string, JsonObject> {
  const projects = asObject(asObject(registry).projects);
  const indexed: Record<string, JsonObject> = {};
  for (const [key, value] of Object.entries(projects)) {
    const project = asObject(value);
    const projectId = stringValue(project.id) ?? key;
    const workspaceId = stringValue(project.workspace);
    if (workspaceId) indexed[projectIdentity(workspaceId, projectId)] = project;
  }
  return indexed;
}

function projectStatus(
  registry: JsonObject,
  files: { render: boolean; manifest: boolean; prompts: boolean; scenario: boolean },
): string {
  if (files.render) return "done";
  if (files.manifest) return "assets";
  if (files.prompts) return "prompts";
  if (files.scenario) return "scenario";
  return stringValue(registry.status) ?? "draft";
}

export function validateIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

export async function validateLibraryRoot(rootPath: string): Promise<string> {
  const resolvedRoot = resolve(rootPath);
  if (basename(resolvedRoot) !== ".ralphy") {
    throw new InvalidLibraryRootError("Library root must be a .ralphy directory");
  }
  const info = await lstat(resolvedRoot).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new InvalidLibraryRootError(
      "Library root must be a real directory, not a symbolic link",
    );
  }
  const canonicalRoot = await realpath(resolvedRoot);
  const workspacesPath = join(canonicalRoot, "workspaces");
  const workspacesInfo = await lstat(workspacesPath).catch(() => null);
  if (!workspacesInfo?.isDirectory() || workspacesInfo.isSymbolicLink()) {
    throw new InvalidLibraryRootError(
      "Library root must contain a real workspaces directory",
    );
  }
  return canonicalRoot;
}

export async function resolveContainedPath(
  rootPath: string,
  candidatePath: string,
  options: { allowMissingLeaf?: boolean } = {},
): Promise<string> {
  const selectedRoot = resolve(rootPath);
  const root = await validateLibraryRoot(rootPath);
  const selectedCandidate = resolve(
    isAbsolute(candidatePath) ? candidatePath : join(selectedRoot, candidatePath),
  );
  const relativeCandidate = isInside(selectedRoot, selectedCandidate)
    && selectedCandidate !== selectedRoot
    ? relative(selectedRoot, selectedCandidate)
    : isInside(root, selectedCandidate) && selectedCandidate !== root
      ? relative(root, selectedCandidate)
      : null;
  if (relativeCandidate === null) {
    throw new Error(`Path is outside the active .ralphy root: ${candidatePath}`);
  }

  const candidate = join(root, relativeCandidate);
  const segments = relative(root, candidate).split(sep);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      if (options.allowMissingLeaf && index === segments.length - 1) return candidate;
      throw new Error(`Path does not exist inside the active library: ${candidatePath}`);
    }
    if (info.isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link: ${candidatePath}`);
    }
  }

  const canonical = await realpath(candidate);
  if (!isInside(root, canonical)) {
    throw new Error(`Path resolves outside the active .ralphy root: ${candidatePath}`);
  }
  return canonical;
}

export async function resolveProjectPath(
  rootPath: string,
  workspaceId: string,
  projectId: string,
): Promise<string> {
  validateIdentifier(workspaceId, "workspace id");
  validateIdentifier(projectId, "project id");
  const path = await resolveContainedPath(
    rootPath,
    join("workspaces", workspaceId, "projects", projectId),
  );
  const info = await lstat(path);
  if (!info.isDirectory()) throw new Error(`Project is not a directory: ${projectId}`);
  return path;
}

export async function readBoundedJson(
  path: string,
  limitBytes = JSON_LIMIT_BYTES,
): Promise<unknown | null> {
  const info = await safeStat(path);
  if (!info?.isFile() || info.size > limitBytes) return null;
  try {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(info.size);
      await file.read(buffer, 0, buffer.length, 0);
      return JSON.parse(buffer.toString("utf8"));
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export async function buildShallowCatalog(
  rootPath: string,
  generation = 0,
  onProgress?: (progress: CatalogProgress) => void,
): Promise<CatalogResult> {
  const root = await validateLibraryRoot(rootPath);
  const registry = registryProjects(await readBoundedJson(join(root, "registry.json")));
  const workspaces: WorkspaceSummary[] = [];
  const projects: ProjectSummary[] = [];
  const workspaceIds = await directDirectories(join(root, "workspaces"));
  let projectsRead = 0;

  for (const workspaceId of workspaceIds) {
    const workspacePath = join(root, "workspaces", workspaceId);
    const workspaceData = asObject(await readBoundedJson(join(workspacePath, "workspace.json")));
    const projectIds = await directDirectories(join(workspacePath, "projects"));
    const sharedCount = await directCount(join(workspacePath, "shared"));
    let unitCount = 0;
    let finalCount = 0;
    let workspaceRecent = await newestMtime([
      workspacePath,
      join(workspacePath, "workspace.json"),
    ]);

    for (const projectId of projectIds) {
      const projectPath = join(workspacePath, "projects", projectId);
      const registryData = registry[projectIdentity(workspaceId, projectId)] ?? {};
      const plan = asObject(await readBoundedJson(join(projectPath, "production-plan.json")));
      const projectUnitCount = await directCount(join(projectPath, "units"));
      const projectFinalCount = await directFinalCount(projectPath);
      const files = {
        render: projectFinalCount > 0,
        manifest: await hasFile(join(projectPath, "asset-manifest.json")),
        prompts: await hasFile(join(projectPath, "prompts.json")),
        scenario: await hasFile(join(projectPath, "scenario.json")),
      };
      const recent = await newestMtime([
        projectPath,
        join(projectPath, "production-plan.json"),
        join(projectPath, "asset-manifest.json"),
        join(projectPath, "BRIEF.md"),
        join(projectPath, "render", "final.mp4"),
      ]);
      const planFormat = asObject(plan.format);
      const project: ProjectSummary = {
        workspaceId,
        projectId,
        id: projectIdentity(workspaceId, projectId),
        name: stringValue(registryData.name, plan.name) ?? projectId,
        brief: stringValue(registryData.brief, plan.brief) ?? "",
        absolutePath: projectPath,
        status: projectStatus(registryData, files),
        phase: stringValue(plan.phase, plan.currentPhase, registryData.phase),
        finalState: stringValue(registryData.finalState) ?? (files.render ? "ready" : "missing"),
        platform: stringValue(plan.platform, registryData.platform),
        aspectRatio: stringValue(
          plan.aspect,
          plan.aspectRatio,
          planFormat.aspect,
          registryData.aspectRatio,
        ),
        spendUsd: finiteNumber(registryData.spendUsd ?? registryData.cost_usd),
        finalCount: projectFinalCount,
        sharedCount,
        unitCount: projectUnitCount,
        recentActivity: isoTime(recent),
      };
      projects.push(project);
      unitCount += projectUnitCount;
      finalCount += projectFinalCount;
      workspaceRecent = Math.max(workspaceRecent, recent);
      projectsRead += 1;
      onProgress?.({
        generation,
        workspacesRead: workspaces.length,
        projectsRead,
      });
    }

    workspaces.push({
      id: workspaceId,
      name: stringValue(workspaceData.name) ?? workspaceId,
      description: stringValue(workspaceData.description) ?? "",
      absolutePath: workspacePath,
      projectCount: projectIds.length,
      sharedCount,
      unitCount,
      finalCount,
      recentActivity: isoTime(workspaceRecent),
    });
  }

  return {
    rootPath: root,
    generation,
    workspaces,
    projects,
    mediaItemCount: 0,
    completedAt: new Date().toISOString(),
  };
}

export async function readBoundedText(
  rootPath: string,
  path: string,
  maxBytes = 256 * 1024,
): Promise<TextReadResult> {
  const safePath = await resolveContainedPath(rootPath, path);
  const info = await stat(safePath);
  if (!info.isFile()) throw new Error(`Path is not a file: ${path}`);
  const readBytes = Math.min(Math.max(1, Math.floor(maxBytes)), TEXT_LIMIT_BYTES, info.size);
  const file = await open(safePath, "r");
  try {
    const buffer = Buffer.alloc(readBytes);
    const { bytesRead } = await file.read(buffer, 0, readBytes, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      totalBytes: info.size,
      truncated: bytesRead < info.size,
    };
  } finally {
    await file.close();
  }
}

export async function trashContainedItems(
  rootPath: string,
  paths: string[],
  trashItem: (path: string) => Promise<void>,
): Promise<TrashResult> {
  const result: TrashResult = { trashed: [], failed: [] };
  for (const path of paths) {
    try {
      const safePath = await resolveContainedPath(rootPath, path);
      await trashItem(safePath);
      result.trashed.push(safePath);
    } catch (error) {
      result.failed.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function ensureContainedParent(
  rootPath: string,
  path: string,
): Promise<string> {
  return resolveContainedPath(rootPath, dirname(path));
}
