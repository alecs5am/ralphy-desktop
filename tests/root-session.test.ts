import { describe, expect, test, vi } from "vitest";

const hello = {
  storeId: "store-next",
  rootId: "root-next",
  activitySequence: 42,
};

describe("main-owned root session", () => {
  test("cleans the old root in security order after replacement hello", async () => {
    const rootSession = await import("../electron/root-session").catch(() => ({}));
    expect(rootSession).toHaveProperty("openRootSession");
    const events: string[] = [];
    const session = {
      root: "/libraries/old/.ralphy",
      hello: { storeId: "store-old", rootId: "root-old", activitySequence: 8 },
      client: {},
      async open(root: string, hooks: {
        preparePreviousClose(previousRoot: string | null): Promise<void>;
        beforePreviousClose(previousRoot: string | null): void;
        afterPreviousClose(previousRoot: string | null): void;
      }) {
        expect(root).toBe("/libraries/next/.ralphy");
        const previousRoot = this.root;
        await hooks.preparePreviousClose(previousRoot);
        hooks.beforePreviousClose(previousRoot);
        events.push("bridge-close");
        this.root = root;
        this.hello = hello;
        hooks.afterPreviousClose(previousRoot);
        return hello;
      },
    };
    const { openRootSession } = rootSession as {
      openRootSession(options: Record<string, unknown>): Promise<unknown>;
    };

    const result = await openRootSession({
      session,
      root: "/libraries/next/.ralphy",
      label: "Next Library",
      invalidateFileTokens: () => events.push("tokens"),
      stopAgentTurns: () => events.push("agent"),
      terminateTerminals: () => events.push("terminals"),
      subscribeActivity: async () => events.push("activity"),
    });

    expect(events).toEqual(["tokens", "agent", "bridge-close", "terminals", "activity"]);
    expect(result).toEqual({ storeId: "store-next", label: "Next Library" });
    expect(result).not.toHaveProperty("root");
  });

  test("retains old-root resources when replacement hello fails", async () => {
    const { openRootSession } = await import("../electron/root-session") as {
      openRootSession(options: Record<string, unknown>): Promise<unknown>;
    };
    const cleanup = vi.fn();
    const session = {
      root: "/libraries/old/.ralphy",
      hello: { storeId: "store-old", rootId: "root-old", activitySequence: 8 },
      client: {},
      async open() {
        throw Object.assign(new Error("invalid root"), { code: "E_ROOT_INVALID" });
      },
    };

    await expect(openRootSession({
      session,
      root: "/libraries/broken/.ralphy",
      label: "Broken",
      invalidateFileTokens: cleanup,
      stopAgentTurns: cleanup,
      terminateTerminals: cleanup,
      subscribeActivity: cleanup,
    })).rejects.toMatchObject({ code: "E_ROOT_INVALID" });

    expect(session.root).toBe("/libraries/old/.ralphy");
    expect(cleanup).not.toHaveBeenCalled();
  });

  test("retains the previous bridge and resources when preparation fails", async () => {
    const { openRootSession } = await import("../electron/root-session") as {
      openRootSession(options: Record<string, unknown>): Promise<unknown>;
    };
    const cleanup = vi.fn();
    const session = {
      root: "/libraries/old/.ralphy",
      hello: { storeId: "store-old", rootId: "root-old", activitySequence: 8 },
      client: {},
      async open(_root: string, hooks: {
        preparePreviousClose(previousRoot: string | null): Promise<void>;
      }) {
        await hooks.preparePreviousClose(this.root);
        throw new Error("previous bridge should remain active");
      },
    };

    await expect(openRootSession({
      session,
      root: "/libraries/next/.ralphy",
      label: "Next",
      prepare: async () => {
        throw new Error("scanner failed");
      },
      invalidateFileTokens: cleanup,
      stopAgentTurns: cleanup,
      terminateTerminals: cleanup,
      subscribeActivity: cleanup,
    })).rejects.toThrow("scanner failed");

    expect(session.root).toBe("/libraries/old/.ralphy");
    expect(cleanup).not.toHaveBeenCalled();
  });

  test("cleans the root selected inside the serialized commit", async () => {
    const { openRootSession } = await import("../electron/root-session") as {
      openRootSession(options: Record<string, unknown>): Promise<unknown>;
    };
    const terminated: string[] = [];
    const session = {
      root: "/libraries/stale/.ralphy",
      hello: { storeId: "store-stale", rootId: "root-stale", activitySequence: 8 },
      client: {},
      async open(root: string, hooks: {
        preparePreviousClose(previousRoot: string | null): Promise<void>;
        beforePreviousClose(previousRoot: string | null): void;
        afterPreviousClose(previousRoot: string | null): void;
      }) {
        const committedPreviousRoot = "/libraries/current/.ralphy";
        await hooks.preparePreviousClose(committedPreviousRoot);
        hooks.beforePreviousClose(committedPreviousRoot);
        this.root = root;
        this.hello = hello;
        hooks.afterPreviousClose(committedPreviousRoot);
        return hello;
      },
    };

    await openRootSession({
      session,
      root: "/libraries/next/.ralphy",
      label: "Next",
      invalidateFileTokens: vi.fn(),
      stopAgentTurns: vi.fn(),
      terminateTerminals: (root: string) => terminated.push(root),
      subscribeActivity: vi.fn(),
    });

    expect(terminated).toEqual(["/libraries/current/.ralphy"]);
  });
});
