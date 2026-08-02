import { randomUUID } from "node:crypto";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import {
  BRIDGE_CONTRACT_VERSION,
  BRIDGE_LIMITS,
  BRIDGE_METHODS,
  BRIDGE_PROTOCOL_VERSION,
  type ActivityDto,
  type BridgeErrorPayload,
  type BridgeEvent,
  type BridgeHello,
  type BridgeMethod,
  type BridgeRequest,
  type FarmConsumerHello,
  type ParamsFor,
  type ResultFor,
} from "./types";

const BRIDGE_METHOD_SET = new Set<string>(BRIDGE_METHODS);
const PASSTHROUGH_ENV_KEYS = ["HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CLOSE_GRACE_MS = 1_000;
const CLOSE_TERM_MS = 1_000;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: RalphyBridgeError): void;
}

interface OutboundRequest extends PendingRequest {
  id: string;
  frame: Buffer;
}

export interface RalphyBridgeClientOptions {
  bin?: string;
  root: string;
  env?: NodeJS.ProcessEnv;
}

export class RalphyBridgeError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RalphyBridgeError";
    this.code = code;
    this.details = details;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function parseError(value: unknown): BridgeErrorPayload | null {
  const error = record(value);
  if (
    !error
    || !exactKeys(error, ["code", "message"], ["details"])
    || typeof error.code !== "string"
    || typeof error.message !== "string"
  ) {
    return null;
  }
  return {
    code: error.code,
    message: error.message,
    ...(Object.hasOwn(error, "details") ? { details: error.details } : {}),
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function sha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function parseFarmConsumer(value: unknown): FarmConsumerHello | undefined {
  if (value === null) return null;
  const farm = record(value);
  if (
    !farm
    || !exactKeys(farm, [
      "namespace",
      "state",
      "coreMigrationRunId",
      "migrationId",
      "stageDigest",
      "readyRecordDigest",
      "identityDigest",
    ])
    || farm.namespace !== "farm"
    || (farm.state !== "pending" && farm.state !== "ready")
    || !safeId(farm.coreMigrationRunId)
    || !safeId(farm.migrationId)
    || !sha256Hex(farm.stageDigest)
    || !sha256Hex(farm.readyRecordDigest)
    || (farm.identityDigest !== null && !sha256Hex(farm.identityDigest))
    || (farm.state === "pending" && farm.identityDigest !== null)
    || (farm.state === "ready" && farm.identityDigest === null)
  ) return undefined;
  return {
    namespace: "farm",
    state: farm.state,
    coreMigrationRunId: farm.coreMigrationRunId,
    migrationId: farm.migrationId,
    stageDigest: farm.stageDigest,
    readyRecordDigest: farm.readyRecordDigest,
    identityDigest: farm.identityDigest,
  };
}

function exactLimits(value: unknown): value is typeof BRIDGE_LIMITS {
  const limits = record(value);
  return !!limits
    && exactKeys(limits, Object.keys(BRIDGE_LIMITS))
    && Object.entries(BRIDGE_LIMITS).every(
      ([key, expected]) => limits[key] === expected,
    );
}

function guiSafePath(home: string): string {
  return [
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

function bridgeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = source.HOME || homedir();
  const environment: NodeJS.ProcessEnv = { PATH: guiSafePath(home) };
  for (const key of PASSTHROUGH_ENV_KEYS) {
    if (source[key]) environment[key] = source[key];
  }
  environment.HOME = home;
  return environment;
}

function parseHello(value: unknown): BridgeHello {
  const hello = record(value);
  if (!hello || typeof hello.protocolVersion !== "number") {
    throw new RalphyBridgeError(
      "E_BRIDGE_PROTOCOL",
      "Ralphy bridge returned an invalid system.hello response",
    );
  }
  if (
    hello.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    || hello.contractVersion !== BRIDGE_CONTRACT_VERSION
  ) {
    throw new RalphyBridgeError(
      "E_BRIDGE_VERSION",
      `Ralphy bridge protocol/contract ${String(hello.protocolVersion)}/${String(hello.contractVersion)} is incompatible with Desktop ${BRIDGE_PROTOCOL_VERSION}/${BRIDGE_CONTRACT_VERSION}. Update Ralphy CLI or Desktop.`,
      {
        expected: {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          contractVersion: BRIDGE_CONTRACT_VERSION,
        },
        received: {
          protocolVersion: hello.protocolVersion,
          contractVersion: hello.contractVersion,
        },
      },
    );
  }
  const consumers = record(hello.consumers);
  const farm = consumers && exactKeys(consumers, ["farm"])
    ? parseFarmConsumer(consumers.farm)
    : undefined;
  const methods = hello.methods;
  if (
    !sequence(hello.schemaVersion)
    || !nonEmptyString(hello.coreVersion)
    || !nonEmptyString(hello.storeId)
    || !nonEmptyString(hello.rootId)
    || !Array.isArray(hello.consumerNamespaces)
    || hello.consumerNamespaces.length !== 1
    || hello.consumerNamespaces[0] !== "farm"
    || farm === undefined
    || !Array.isArray(methods)
    || !methods.every((method) => typeof method === "string")
    || new Set(methods).size !== methods.length
    || !sequence(hello.activitySequence)
    || !exactLimits(hello.limits)
  ) {
    throw new RalphyBridgeError(
      "E_BRIDGE_PROTOCOL",
      "Ralphy bridge returned an invalid system.hello response",
    );
  }
  if (
    methods.length !== BRIDGE_METHODS.length
    || !methods.every((method) => BRIDGE_METHOD_SET.has(method))
  ) {
    throw new RalphyBridgeError(
      "E_BRIDGE_VERSION",
      "Ralphy bridge capabilities are incompatible with this Desktop version. Update Ralphy CLI or Desktop.",
    );
  }
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    contractVersion: BRIDGE_CONTRACT_VERSION,
    schemaVersion: hello.schemaVersion,
    coreVersion: hello.coreVersion,
    storeId: hello.storeId,
    rootId: hello.rootId,
    consumerNamespaces: ["farm"],
    consumers: { farm },
    methods: methods as BridgeMethod[],
    activitySequence: hello.activitySequence,
    limits: BRIDGE_LIMITS,
  };
}

function parseActivity(value: unknown, eventSequence: number): ActivityDto | null {
  const activity = record(value);
  if (
    !activity
    || !exactKeys(activity, [
      "sequence",
      "workspaceId",
      "projectId",
      "entityType",
      "entityId",
      "action",
      "createdAt",
    ])
    || activity.sequence !== eventSequence
    || !sequence(activity.sequence)
    || !nullableString(activity.workspaceId)
    || !nullableString(activity.projectId)
    || !nonEmptyString(activity.entityType)
    || !nonEmptyString(activity.entityId)
    || !nonEmptyString(activity.action)
    || typeof activity.createdAt !== "number"
    || !Number.isFinite(activity.createdAt)
  ) return null;
  return {
    sequence: activity.sequence,
    workspaceId: activity.workspaceId,
    projectId: activity.projectId,
    entityType: activity.entityType,
    entityId: activity.entityId,
    action: activity.action,
    createdAt: activity.createdAt,
  };
}

export class RalphyBridgeClient {
  readonly #bin: string;
  readonly #root: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #pending = new Map<string, PendingRequest>();
  readonly #outbound: OutboundRequest[] = [];
  readonly #listeners = new Set<(event: BridgeEvent) => void>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdoutChunks: Buffer[] = [];
  #stdoutBytes = 0;
  #outboundBytes = 0;
  #stdinBlocked = false;
  #hello: BridgeHello | null = null;
  #startPromise: Promise<BridgeHello> | null = null;
  #closePromise: Promise<void> | null = null;
  #terminalError: RalphyBridgeError | null = null;
  #closed = false;

  constructor(options: RalphyBridgeClientOptions) {
    const environment = options.env ?? process.env;
    this.#bin = options.bin || environment.RALPHY_BIN || "ralphy";
    this.#root = options.root;
    this.#env = bridgeEnvironment(environment);
  }

  start(): Promise<BridgeHello> {
    if (this.#closed) return Promise.reject(this.#closedError());
    if (this.#hello) return Promise.resolve(this.#hello);
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = this.#start();
    return this.#startPromise;
  }

  async request<Method extends BridgeMethod>(
    method: Method,
    params: ParamsFor<Method>,
  ): Promise<ResultFor<Method>> {
    if (this.#closed) throw this.#closedError();
    if (this.#terminalError) throw this.#terminalError;
    if (!this.#hello) {
      throw new RalphyBridgeError(
        "E_BRIDGE_NOT_READY",
        "Start the Ralphy bridge and wait for system.hello before sending requests",
      );
    }
    return await this.#send(method, params) as ResultFor<Method>;
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#rejectPending(this.#closedError());

    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    this.#closePromise = new Promise((resolve) => {
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (killTimer) clearTimeout(killTimer);
        child.off("close", finish);
        resolve();
      };
      child.once("close", finish);
      graceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          finish();
        }, CLOSE_TERM_MS);
      }, CLOSE_GRACE_MS);
      if (!child.stdin.destroyed) child.stdin.end();
    });
    return this.#closePromise;
  }

  async #start(): Promise<BridgeHello> {
    try {
      this.#spawn();
      const result = await this.#send("system.hello", {});
      const hello = parseHello(result);
      if (this.#terminalError) throw this.#terminalError;
      this.#hello = hello;
      return hello;
    } catch (error) {
      const bridgeError = error instanceof RalphyBridgeError
        ? error
        : new RalphyBridgeError(
          "E_BRIDGE_START",
          error instanceof Error ? error.message : "Unable to start the Ralphy bridge",
        );
      this.#fail(bridgeError);
      throw bridgeError;
    }
  }

  #spawn(): void {
    const child = spawn(
      this.#bin,
      ["bridge", "--stdio", "--root", this.#root],
      { env: this.#env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#readStdout(chunk));
    child.stderr.resume();
    child.stdin.on("error", (error) => {
      if (!this.#closed) this.#fail(new RalphyBridgeError("E_BRIDGE_WRITE", error.message));
    });
    child.once("error", (error) => {
      this.#fail(new RalphyBridgeError("E_BRIDGE_START", error.message));
    });
    child.once("close", (code, signal) => {
      if (!this.#closed && !this.#terminalError) {
        this.#terminalError = new RalphyBridgeError(
          "E_BRIDGE_EXITED",
          `Ralphy bridge exited unexpectedly (${signal ?? code ?? "unknown"})`,
          { code, signal },
        );
      }
      this.#rejectPending(this.#terminalError ?? this.#closedError());
      this.#child = null;
    });
  }

  #send(method: string, params: unknown): Promise<unknown> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) {
      return Promise.reject(this.#terminalError ?? new RalphyBridgeError(
        "E_BRIDGE_EXITED",
        "Ralphy bridge is not running",
      ));
    }

    const id = randomUUID();
    const request: BridgeRequest = { v: 1, id, method, params };
    let serialized: string;
    try {
      serialized = JSON.stringify(request);
    } catch (error) {
      return Promise.reject(new RalphyBridgeError(
        "E_BRIDGE_REQUEST",
        error instanceof Error ? error.message : "Unable to serialize bridge request",
      ));
    }
    const frameBytes = Buffer.byteLength(serialized);
    if (frameBytes > BRIDGE_LIMITS.maxFrameBytes) {
      return Promise.reject(new RalphyBridgeError(
        "E_BRIDGE_FRAME_TOO_LARGE",
        "Ralphy bridge request exceeds the one MiB frame limit",
      ));
    }
    const frame = Buffer.from(`${serialized}\n`);
    return new Promise((resolve, reject) => {
      if (this.#outboundBytes + frame.byteLength > BRIDGE_LIMITS.maxOutboundBytes) {
        reject(new RalphyBridgeError(
          "E_BRIDGE_BACKPRESSURE",
          "Ralphy bridge request queue is full",
        ));
        return;
      }
      this.#outbound.push({ id, frame, resolve, reject });
      this.#outboundBytes += frame.byteLength;
      this.#pumpWrites();
    });
  }

  #readStdout(chunk: Buffer): void {
    if (this.#closed || this.#terminalError) return;
    let offset = 0;
    let newline = chunk.indexOf(0x0a, offset);
    while (newline !== -1) {
      const segment = chunk.subarray(offset, newline);
      const lineBytes = this.#stdoutBytes + segment.byteLength;
      if (lineBytes > BRIDGE_LIMITS.maxFrameBytes) {
        this.#protocolFailure("Ralphy bridge emitted a line larger than one MiB");
        return;
      }
      const line = this.#stdoutChunks.length === 0
        ? segment
        : Buffer.concat([...this.#stdoutChunks, segment], lineBytes);
      this.#stdoutChunks = [];
      this.#stdoutBytes = 0;
      const end = line.at(-1) === 0x0d ? line.byteLength - 1 : line.byteLength;
      let text: string;
      try {
        text = this.#decoder.decode(line.subarray(0, end));
      } catch {
        this.#protocolFailure("Ralphy bridge emitted invalid UTF-8 on stdout");
        return;
      }
      this.#parseLine(text);
      if (this.#terminalError) return;
      offset = newline + 1;
      newline = chunk.indexOf(0x0a, offset);
    }
    const remainder = chunk.subarray(offset);
    if (this.#stdoutBytes + remainder.byteLength > BRIDGE_LIMITS.maxFrameBytes) {
      this.#protocolFailure("Ralphy bridge emitted a line larger than one MiB");
      return;
    }
    if (remainder.byteLength > 0) this.#stdoutChunks.push(Buffer.from(remainder));
    this.#stdoutBytes += remainder.byteLength;
  }

  #pumpWrites(): void {
    if (this.#closed || this.#terminalError || this.#stdinBlocked) return;
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) return;

    while (this.#pending.size < BRIDGE_LIMITS.maxInFlight) {
      const outbound = this.#outbound.shift();
      if (!outbound) return;
      this.#outboundBytes -= outbound.frame.byteLength;
      this.#pending.set(outbound.id, outbound);
      let writable: boolean;
      try {
        writable = child.stdin.write(outbound.frame, (error) => {
          if (error) this.#fail(new RalphyBridgeError("E_BRIDGE_WRITE", error.message));
        });
      } catch (error) {
        this.#fail(new RalphyBridgeError(
          "E_BRIDGE_WRITE",
          error instanceof Error ? error.message : "Unable to write bridge request",
        ));
        return;
      }
      if (!writable) {
        this.#stdinBlocked = true;
        child.stdin.once("drain", () => {
          this.#stdinBlocked = false;
          this.#pumpWrites();
        });
        return;
      }
    }
  }

  #parseLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.#protocolFailure("Ralphy bridge emitted invalid JSON on stdout");
      return;
    }
    const message = record(value);
    if (!message || message.v !== BRIDGE_PROTOCOL_VERSION) {
      this.#protocolFailure("Ralphy bridge emitted an invalid protocol envelope");
      return;
    }
    if (Object.hasOwn(message, "event")) {
      this.#receiveEvent(message);
      return;
    }
    this.#receiveResponse(message);
  }

  #receiveEvent(message: Record<string, unknown>): void {
    if (!sequence(message.sequence)) {
      this.#protocolFailure("Ralphy bridge emitted an invalid event envelope");
      return;
    }
    let event: BridgeEvent;
    if (message.event === "activity") {
      const activity = parseActivity(message.data, message.sequence);
      if (
        !exactKeys(message, ["v", "event", "subscriptionId", "sequence", "data"])
        || !nonEmptyString(message.subscriptionId)
        || !activity
      ) {
        this.#protocolFailure("Ralphy bridge emitted an invalid activity event");
        return;
      }
      event = {
        v: BRIDGE_PROTOCOL_VERSION,
        event: "activity",
        subscriptionId: message.subscriptionId,
        sequence: message.sequence,
        data: activity,
      };
    } else if (message.event === "agent") {
      if (
        !exactKeys(message, ["v", "event", "agentSessionId", "turnId", "sequence", "data"])
        || !nonEmptyString(message.agentSessionId)
        || !nonEmptyString(message.turnId)
      ) {
        this.#protocolFailure("Ralphy bridge emitted an invalid agent event");
        return;
      }
      event = {
        v: BRIDGE_PROTOCOL_VERSION,
        event: "agent",
        agentSessionId: message.agentSessionId,
        turnId: message.turnId,
        sequence: message.sequence,
        data: message.data,
      };
    } else {
      this.#protocolFailure("Ralphy bridge emitted an invalid event envelope");
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // One renderer listener must not corrupt the bridge stream.
      }
    }
  }

  #receiveResponse(message: Record<string, unknown>): void {
    if (typeof message.ok !== "boolean") {
      this.#protocolFailure("Ralphy bridge emitted an invalid response envelope");
      return;
    }
    if (
      (message.ok && !exactKeys(message, ["v", "id", "ok", "result"]))
      || (!message.ok && !exactKeys(message, ["v", "id", "ok", "error"]))
    ) {
      this.#protocolFailure("Ralphy bridge emitted an invalid response envelope");
      return;
    }
    if (message.id === null && message.ok === false) {
      const fatal = parseError(message.error);
      if (!fatal) {
        this.#protocolFailure("Ralphy bridge returned an invalid fatal error envelope");
        return;
      }
      this.#fail(new RalphyBridgeError(fatal.code, fatal.message, fatal.details));
      return;
    }
    if (typeof message.id !== "string") {
      this.#protocolFailure("Ralphy bridge emitted an invalid response envelope");
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.#protocolFailure("Ralphy bridge responded with an unknown request id");
      return;
    }
    this.#pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
      this.#pumpWrites();
      return;
    }
    const error = parseError(message.error);
    if (!error) {
      pending.reject(new RalphyBridgeError(
        "E_BRIDGE_PROTOCOL",
        "Ralphy bridge returned an invalid error envelope",
      ));
      this.#protocolFailure("Ralphy bridge returned an invalid error envelope");
      return;
    }
    pending.reject(new RalphyBridgeError(error.code, error.message, error.details));
    this.#pumpWrites();
  }

  #protocolFailure(message: string): void {
    this.#fail(new RalphyBridgeError("E_BRIDGE_PROTOCOL", message));
  }

  #fail(error: RalphyBridgeError): void {
    this.#terminalError ??= error;
    this.#rejectPending(this.#terminalError);
    const child = this.#child;
    if (child && child.exitCode === null && !child.killed) child.kill();
  }

  #rejectPending(error: RalphyBridgeError): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    for (const outbound of this.#outbound) outbound.reject(error);
    this.#outbound.length = 0;
    this.#outboundBytes = 0;
  }

  #closedError(): RalphyBridgeError {
    return new RalphyBridgeError("E_BRIDGE_CLOSED", "Ralphy bridge is closed");
  }
}
