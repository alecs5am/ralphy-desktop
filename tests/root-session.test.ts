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
        beforePreviousClose(): Promise<void>;
        afterPreviousClose(): void;
      }) {
        expect(root).toBe("/libraries/next/.ralphy");
        await hooks.beforePreviousClose();
        events.push("bridge-close");
        this.root = root;
        this.hello = hello;
        hooks.afterPreviousClose();
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
      async open(_root: string, hooks: { beforePreviousClose(): Promise<void> }) {
        await hooks.beforePreviousClose();
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
});
