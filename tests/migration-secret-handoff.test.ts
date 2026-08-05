import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import {
  SECRET_HANDOFF_REQUEST_MAX_BYTES,
  assertCanonicalStagedRoot,
  dispatchDesktopStartup,
  parseSecretHandoffRequest,
  readSecretHandoffRequest,
  runSecretHandoff,
  secretFileForProvider,
  type SecretHandoffBridge,
} from "../electron/migration/secret-handoff";

const runId = "mig_11111111-1111-4111-8111-111111111111";
const sourceEntryId = "mentry_22222222-2222-4222-8222-222222222222";
const workspaceId = "ws_33333333-3333-4333-8333-333333333333";

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    runId,
    root: `/tmp/ralphy/.ralphy-staging/${runId}/.ralphy`,
    sourceEntryId,
    ref: `provider/anthropic/workspace/${workspaceId}/workspace/${workspaceId}`,
    provider: "anthropic",
    ...overrides,
  };
}

describe("migration secret handoff request", () => {
  test("parses the exact bounded stdin request", async () => {
    const raw = JSON.stringify(request());
    const parsed = parseSecretHandoffRequest(raw);
    expect(parsed).toEqual(request());

    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from(raw.slice(0, 17));
      yield Buffer.from(raw.slice(17));
    }
    await expect(readSecretHandoffRequest(chunks())).resolves.toEqual(request());
  });

  test("maps only the two audited providers to their owned files", () => {
    expect(secretFileForProvider("anthropic")).toBe("claude-api-key.bin");
    expect(secretFileForProvider("openrouter")).toBe("openrouter-api-key.bin");
    expect(() => secretFileForProvider("claude")).toThrow();
    expect(() => secretFileForProvider("__proto__")).toThrow();
  });

  test.each([
    ["extra field", request({ extra: true })],
    ["missing field", (() => { const value = request(); delete value.ref; return value; })()],
    ["wrong version", request({ v: 2 })],
    ["relative root", request({ root: `.ralphy-staging/${runId}/.ralphy` })],
    ["normal live root", request({ root: "/tmp/ralphy/.ralphy" })],
    ["non-normal root", request({ root: `/tmp/ralphy/../ralphy/.ralphy-staging/${runId}/.ralphy` })],
    ["root run mismatch", request({ root: "/tmp/ralphy/.ralphy-staging/mig_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/.ralphy" })],
    ["unsafe migration id", request({ runId: "mig_../escape" })],
    ["unsafe source entry id", request({ sourceEntryId: "entry_missing" })],
    ["provider ref mismatch", request({ provider: "openrouter" })],
    ["ref workspace mismatch", request({ ref: `provider/anthropic/workspace/${workspaceId}/workspace/ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` })],
    ["unsupported provider", request({ provider: "claude" })],
  ])("rejects %s", (_name, value) => {
    expect(() => parseSecretHandoffRequest(JSON.stringify(value))).toThrow();
  });

  test("rejects malformed, multiple, empty, and oversized stdin", async () => {
    expect(() => parseSecretHandoffRequest("not-json")).toThrow();
    expect(() => parseSecretHandoffRequest(`${JSON.stringify(request())}\n{}`)).toThrow();
    expect(() => parseSecretHandoffRequest("")).toThrow();

    async function* oversized(): AsyncGenerator<Buffer> {
      yield Buffer.alloc(SECRET_HANDOFF_REQUEST_MAX_BYTES, 0x20);
      yield Buffer.from("x");
    }
    await expect(readSecretHandoffRequest(oversized())).rejects.toThrow();
  });

  test("rejects a staged-root symlink before credential access", async () => {
    const fixture = await realpath(await mkdtemp(join(tmpdir(), "ralphy-secret-handoff-")));
    const runRoot = join(fixture, ".ralphy-staging", runId);
    const liveRoot = join(fixture, ".ralphy");
    const stagedRoot = join(runRoot, ".ralphy");
    try {
      await mkdir(runRoot, { recursive: true });
      await mkdir(liveRoot);
      await symlink(liveRoot, stagedRoot);
      await expect(assertCanonicalStagedRoot(stagedRoot)).rejects.toThrow();
      await rm(stagedRoot);
      await mkdir(stagedRoot);
      await expect(assertCanonicalStagedRoot(stagedRoot)).resolves.toBeUndefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});

describe("migration secret handoff lifecycle", () => {
  function setupBridge(options: {
    result?: unknown;
    startError?: Error;
    requestError?: Error;
  } = {}) {
    const calls = { created: 0, started: 0, requested: [] as unknown[][], closed: 0 };
    const bridge: SecretHandoffBridge = {
      async start() {
        calls.started += 1;
        if (options.startError) throw options.startError;
      },
      async request(method, params) {
        calls.requested.push([method, params]);
        if (options.requestError) throw options.requestError;
        return options.result ?? {
          ref: request().ref,
          kind: "text",
          completed: true,
        };
      },
      async close() {
        calls.closed += 1;
      },
    };
    return {
      calls,
      createBridge(root: string) {
        calls.created += 1;
        expect(root).toBe(request().root);
        return bridge;
      },
    };
  }

  test("validates the physical staged root before decrypting", async () => {
    const fixture = setupBridge();
    const read = vi.fn(async () => "sk-ant-fixture-secret-value");
    await expect(runSecretHandoff(parseSecretHandoffRequest(JSON.stringify(request())), {
      stores: { anthropic: { read }, openrouter: { read: async () => null } },
      createBridge: fixture.createBridge,
      validateRoot: async () => { throw new Error("staged root is an alias"); },
    })).rejects.toThrow("staged root is an alias");
    expect(read).not.toHaveBeenCalled();
    expect(fixture.calls.created).toBe(0);
  });

  test("decrypts one selected entry and sends one write-only bridge request", async () => {
    const fixture = setupBridge();
    const reads = { anthropic: 0, openrouter: 0 };
    const secret = "sk-ant-fixture-secret-value";

    await expect(runSecretHandoff(parseSecretHandoffRequest(JSON.stringify(request())), {
      stores: {
        anthropic: { read: async () => { reads.anthropic += 1; return secret; } },
        openrouter: { read: async () => { reads.openrouter += 1; return "unused"; } },
      },
      createBridge: fixture.createBridge,
      validateRoot: async () => undefined,
    })).resolves.toBeUndefined();

    expect(reads).toEqual({ anthropic: 1, openrouter: 0 });
    expect(fixture.calls).toEqual({
      created: 1,
      started: 1,
      requested: [["migration.secret.import", {
        runId,
        sourceEntryId,
        ref: request().ref,
        kind: "text",
        value: secret,
      }]],
      closed: 1,
    });
  });

  test.each([
    ["missing", async () => null],
    ["decrypt-invalid", async () => { throw new Error("decrypt failed"); }],
  ])("fails closed before starting a bridge for a %s credential", async (_name, read) => {
    const fixture = setupBridge();
    await expect(runSecretHandoff(parseSecretHandoffRequest(JSON.stringify(request())), {
      stores: { anthropic: { read }, openrouter: { read: async () => null } },
      createBridge: fixture.createBridge,
      validateRoot: async () => undefined,
    })).rejects.toThrow();
    expect(fixture.calls).toEqual({ created: 0, started: 0, requested: [], closed: 0 });
  });

  test.each([
    ["wrong ref", { ref: "provider/anthropic/workspace/ws_wrong/workspace/ws_wrong", kind: "text", completed: true }],
    ["wrong kind", { ref: request().ref, kind: "file", completed: true }],
    ["not completed", { ref: request().ref, kind: "text", completed: false }],
    ["extra field", { ref: request().ref, kind: "text", completed: true, secret: "leak" }],
    ["missing field", { ref: request().ref, completed: true }],
  ])("rejects a %s bridge result and closes the child", async (_name, result) => {
    const fixture = setupBridge({ result });
    await expect(runSecretHandoff(parseSecretHandoffRequest(JSON.stringify(request())), {
      stores: {
        anthropic: { read: async () => "sk-ant-fixture-secret-value" },
        openrouter: { read: async () => null },
      },
      createBridge: fixture.createBridge,
      validateRoot: async () => undefined,
    })).rejects.toThrow();
    expect(fixture.calls.closed).toBe(1);
  });

  test.each([
    ["start failure", { startError: new Error("child failed") }],
    ["request failure", { requestError: new Error("child failed") }],
  ])("closes the bridge after %s without writing stdout or stderr", async (_name, options) => {
    const fixture = setupBridge(options);
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      await expect(runSecretHandoff(parseSecretHandoffRequest(JSON.stringify(request())), {
        stores: {
          anthropic: { read: async () => "sk-ant-fixture-secret-value" },
          openrouter: { read: async () => null },
        },
        createBridge: fixture.createBridge,
        validateRoot: async () => undefined,
      })).rejects.toThrow("child failed");
      expect(fixture.calls.closed).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test("selects helper mode before every normal Desktop startup seam", () => {
    const helper = vi.fn();
    const seams = {
      ipc: vi.fn(),
      protocol: vi.fn(),
      window: vi.fn(),
      watcher: vi.fn(),
      interval: vi.fn(),
      terminal: vi.fn(),
      agent: vi.fn(),
      restart: vi.fn(),
    };
    const normal = vi.fn(() => Object.values(seams).forEach((start) => start()));

    dispatchDesktopStartup(["electron", "app", "--migration-secret-handoff"], helper, normal);

    expect(helper).toHaveBeenCalledTimes(1);
    expect(normal).not.toHaveBeenCalled();
    for (const start of Object.values(seams)) expect(start).not.toHaveBeenCalled();
  });
});
