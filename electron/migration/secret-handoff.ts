import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

import type {
  MigrationSecretImportParams,
  MigrationSecretImportResult,
} from "../ralphy/types";

export const SECRET_HANDOFF_REQUEST_MAX_BYTES = 16 * 1024;
export const SECRET_HANDOFF_FLAG = "--migration-secret-handoff";

const REQUEST_FIELDS = [
  "v", "runId", "root", "rootId", "rootDevice", "rootInode",
  "maintenanceNonce", "sourceEntryId", "ref", "provider",
] as const;
const RUN_ID = /^mig_[A-Za-z0-9][A-Za-z0-9-]{0,123}$/;
const SOURCE_ENTRY_ID = /^mentry_[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const WORKSPACE_ID = /^ws_[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAINTENANCE_NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export type SecretHandoffProvider = "anthropic" | "openrouter";

export interface SecretHandoffRequest {
  v: 1;
  runId: string;
  root: string;
  rootId: string;
  rootDevice: number;
  rootInode: number;
  maintenanceNonce: string;
  sourceEntryId: string;
  ref: string;
  provider: SecretHandoffProvider;
}

export interface SecretHandoffBridge {
  start(): Promise<{ rootId: string }>;
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
  captureRoot(root: string): Promise<SecretHandoffRootIdentity>;
  authorizeMaintenance(request: SecretHandoffRequest): Promise<void>;
}

export interface SecretHandoffRootIdentity {
  rootId: string;
  rootDevice: number;
  rootInode: number;
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
    || typeof value.rootId !== "string"
    || !SHA256_HEX.test(value.rootId)
    || !safeFilesystemInteger(value.rootDevice)
    || !safeFilesystemInteger(value.rootInode)
    || typeof value.maintenanceNonce !== "string"
    || !MAINTENANCE_NONCE.test(value.maintenanceNonce)
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
  await dependencies.authorizeMaintenance(request);
  await assertExpectedRootIdentity(request, dependencies.captureRoot);
  let secret = await dependencies.stores[request.provider].read();
  if (!secret) throw new Error("Desktop credential is unavailable");
  let bridge: SecretHandoffBridge | null = null;
  try {
    await assertExpectedRootIdentity(request, dependencies.captureRoot);
    bridge = dependencies.createBridge(request.root);
    const hello = await bridge.start();
    if (hello.rootId !== request.rootId) throw new Error("Bridge root identity mismatch");
    await assertExpectedRootIdentity(request, dependencies.captureRoot);
    await assertExpectedRootIdentity(request, dependencies.captureRoot);
    const result = await bridge.request("migration.secret.import", {
      runId: request.runId,
      sourceEntryId: request.sourceEntryId,
      ref: request.ref,
      kind: "text",
      value: secret,
    });
    await assertExpectedRootIdentity(request, dependencies.captureRoot);
    assertSecretImportResult(result, request.ref);
  } finally {
    secret = null;
    await bridge?.close();
  }
}

export async function captureStagedRootIdentity(root: string): Promise<SecretHandoffRootIdentity> {
  if (await realpath(root) !== root) {
    throw new Error("Secret handoff root must be a canonical staged directory");
  }
  const handle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat();
    if (!info.isDirectory() || !safeFilesystemInteger(info.dev) || !safeFilesystemInteger(info.ino)) {
      throw new Error("Secret handoff root must be a canonical staged directory");
    }
    return {
      rootId: createHash("sha256").update(`${resolve(root)}\0${info.dev}\0${info.ino}`).digest("hex"),
      rootDevice: info.dev,
      rootInode: info.ino,
    };
  } finally {
    await handle.close();
  }
}

export async function assertCanonicalStagedRoot(root: string): Promise<void> {
  await captureStagedRootIdentity(root);
}

export async function unboundSecretHandoffAuthorization(): Promise<never> {
  throw new Error("Task 8 PID and maintenance nonce binding is not installed");
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

function safeFilesystemInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

async function assertExpectedRootIdentity(
  request: SecretHandoffRequest,
  capture: (root: string) => Promise<SecretHandoffRootIdentity>,
): Promise<void> {
  const identity = await capture(request.root);
  if (
    identity.rootId !== request.rootId
    || identity.rootDevice !== request.rootDevice
    || identity.rootInode !== request.rootInode
  ) {
    throw new Error("Secret handoff root identity mismatch");
  }
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
