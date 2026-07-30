import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolveContainedPath, validateLibraryRoot } from "./catalog";
import type { MediaKind, ProjectScanResult } from "./types";

const PREVIEWABLE_KINDS = new Set<MediaKind>(["image", "video", "audio", "pdf"]);
const DEFAULT_MAX_ASSET_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_MAX_TOKENS = 4096;

export class MediaProtocolAccess {
  readonly #maxAssetBytes: number;
  readonly #maxTokens: number;
  readonly #allowedPaths = new Map<string, MediaKind>();
  readonly #pathsByToken = new Map<string, string>();
  readonly #tokensByPath = new Map<string, string>();
  #rootPath: string | null = null;

  constructor(options: { maxAssetBytes?: number; maxTokens?: number } = {}) {
    this.#maxAssetBytes = Math.max(1, Math.floor(
      options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
    ));
    this.#maxTokens = Math.max(1, Math.floor(options.maxTokens ?? DEFAULT_MAX_TOKENS));
  }

  clear(): void {
    this.#rootPath = null;
    this.#allowedPaths.clear();
    this.#pathsByToken.clear();
    this.#tokensByPath.clear();
  }

  replace(result: ProjectScanResult): void {
    this.clear();
    this.#rootPath = result.rootPath;
    for (const item of result.items) {
      this.#allowedPaths.set(item.absolutePath, item.kind);
    }
  }

  async mint(rootPath: string, requestedPath: string): Promise<string> {
    const path = await this.#validate(rootPath, requestedPath);
    const existing = this.#tokensByPath.get(path);
    if (existing) return existing;

    const token = randomUUID();
    this.#pathsByToken.set(token, path);
    this.#tokensByPath.set(path, token);
    while (this.#pathsByToken.size > this.#maxTokens) {
      const oldest = this.#pathsByToken.entries().next().value as [string, string] | undefined;
      if (!oldest) break;
      this.#pathsByToken.delete(oldest[0]);
      this.#tokensByPath.delete(oldest[1]);
    }
    return token;
  }

  async resolve(rootPath: string, token: string): Promise<string> {
    const path = this.#pathsByToken.get(token);
    if (!path) throw new Error("Unknown media token");
    return this.#validate(rootPath, path);
  }

  async #validate(rootPath: string, requestedPath: string): Promise<string> {
    const root = await validateLibraryRoot(rootPath);
    if (root !== this.#rootPath) throw new Error("Media scan is no longer active");
    const path = await resolveContainedPath(rootPath, requestedPath);
    const kind = this.#allowedPaths.get(path);
    if (!kind) throw new Error("Path is not selected project media");
    if (!PREVIEWABLE_KINDS.has(kind)) throw new Error("Unsupported media kind");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Media path is not a regular file");
    if (info.size > this.#maxAssetBytes) throw new Error("Media exceeds the size limit");
    return path;
  }
}
