import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

import type {
  MigrationSecretImportParams,
  MigrationSecretImportResult,
} from "../ralphy/types";

export const SECRET_HANDOFF_REQUEST_MAX_BYTES = 16 * 1024;
export const SECRET_HANDOFF_FLAG = "--migration-secret-handoff";

const REQUEST_FIELDS = ["v", "runId", "root", "sourceEntryId", "ref", "provider"] as const;
const RUN_ID = /^mig_[A-Za-z0-9][A-Za-z0-9-]{0,123}$/;
const SOURCE_ENTRY_ID = /^mentry_[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const WORKSPACE_ID = /^ws_[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/;

export type SecretHandoffProvider = "anthropic" | "openrouter";

export interface SecretHandoffRequest {
  v: 1;
  runId: string;
  root: string;
  sourceEntryId: string;
  ref: string;
  provider: SecretHandoffProvider;
}

export interface SecretHandoffBridge {
  start(): Promise<unknown>;
  request(
    method: "migration.secret.import",
    params: MigrationSecretImportParams,
  ): Promise<unknown>;
  close(): Promise<void>;
}

interface SecretHandoffCredentialStore {
  read(): Promise<string | null>;
}

interface SecretHandoffDependencies {
  stores: Record<SecretHandoffProvider, SecretHandoffCredentialStore>;
  createBridge(root: string): SecretHandoffBridge;
  validateRoot(root: string): Promise<void>;
}

export function secretFileForProvider(provider: unknown): string {
  if (provider === "anthropic") return "claude-api-key.bin";
  if (provider === "openrouter") return "openrouter-api-key.bin";
  throw new Error("Unsupported secret handoff provider");
}

export function parseSecretHandoffRequest(raw: string): SecretHandoffRequest {
  if (!raw || Buffer.byteLength(raw) > SECRET_HANDOFF_REQUEST_MAX_BYTES) {
    throw new Error("Invalid secret handoff request size");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid secret handoff request");
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== REQUEST_FIELDS.length || !REQUEST_FIELDS.every((key) => Object.hasOwn(value, key))) {
    throw new Error("Invalid secret handoff request fields");
  }
  const provider = value.provider;
  secretFileForProvider(provider);
  if (
    value.v !== 1
    || typeof value.runId !== "string"
    || !RUN_ID.test(value.runId)
    || typeof value.root !== "string"
    || !validStagedRoot(value.root, value.runId)
    || typeof value.sourceEntryId !== "string"
    || !SOURCE_ENTRY_ID.test(value.sourceEntryId)
    || typeof value.ref !== "string"
    || !validProviderRef(value.ref, provider)
  ) {
    throw new Error("Invalid secret handoff request");
  }
  return value as unknown as SecretHandoffRequest;
}

export async function readSecretHandoffRequest(
  input: AsyncIterable<Buffer | Uint8Array | string>,
): Promise<SecretHandoffRequest> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > SECRET_HANDOFF_REQUEST_MAX_BYTES) {
      throw new Error("Secret handoff request is too large");
    }
    chunks.push(buffer);
  }
  return parseSecretHandoffRequest(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)),
  );
}

export async function runSecretHandoff(
  request: SecretHandoffRequest,
  dependencies: SecretHandoffDependencies,
): Promise<void> {
  await dependencies.validateRoot(request.root);
  let secret = await dependencies.stores[request.provider].read();
  if (!secret) throw new Error("Desktop credential is unavailable");
  const bridge = dependencies.createBridge(request.root);
  try {
    await bridge.start();
    const result = await bridge.request("migration.secret.import", {
      runId: request.runId,
      sourceEntryId: request.sourceEntryId,
      ref: request.ref,
      kind: "text",
      value: secret,
    });
    assertSecretImportResult(result, request.ref);
  } finally {
    secret = null;
    await bridge.close();
  }
}

export async function assertCanonicalStagedRoot(root: string): Promise<void> {
  const [canonical, info] = await Promise.all([realpath(root), lstat(root)]);
  if (canonical !== root || info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Secret handoff root must be a canonical staged directory");
  }
}

export function dispatchDesktopStartup(
  argv: readonly string[],
  startSecretHandoff: () => void,
  startNormalDesktop: () => void,
): void {
  (argv.includes(SECRET_HANDOFF_FLAG) ? startSecretHandoff : startNormalDesktop)();
}

function validStagedRoot(root: string, runId: string): boolean {
  return root.length <= 4096
    && !/[\r\n\0]/.test(root)
    && isAbsolute(root)
    && resolve(root) === root
    && basename(root) === ".ralphy"
    && basename(dirname(root)) === runId
    && basename(dirname(dirname(root))) === ".ralphy-staging";
}

function validProviderRef(ref: string, provider: unknown): boolean {
  if (ref.length > 512) return false;
  const parts = ref.split("/");
  return parts.length === 6
    && parts[0] === "provider"
    && parts[1] === provider
    && parts[2] === "workspace"
    && WORKSPACE_ID.test(parts[3] ?? "")
    && parts[4] === "workspace"
    && parts[5] === parts[3];
}

function assertSecretImportResult(
  result: unknown,
  ref: string,
): asserts result is MigrationSecretImportResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid migration secret import result");
  }
  const value = result as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3
    || !Object.hasOwn(value, "ref")
    || !Object.hasOwn(value, "kind")
    || !Object.hasOwn(value, "completed")
    || value.ref !== ref
    || value.kind !== "text"
    || value.completed !== true
  ) {
    throw new Error("Invalid migration secret import result");
  }
}
