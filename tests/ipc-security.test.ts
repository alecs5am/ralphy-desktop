import { describe, expect, test, vi } from "vitest";

describe("Electron IPC security", () => {
  test("maps bridge codes without exposing unknown error messages", async () => {
    const security = await import("../electron/ipc-security").catch(() => ({}));

    expect(security).toHaveProperty("toIpcResult");
    const { toIpcResult } = security as {
      toIpcResult<T>(run: () => Promise<T>): Promise<unknown>;
    };
    await expect(toIpcResult(async () => {
      throw Object.assign(new Error("safe conflict"), { code: "E_CONFLICT" });
    })).resolves.toEqual({
      ok: false,
      error: { code: "E_CONFLICT", message: "safe conflict" },
    });
    await expect(toIpcResult(async () => {
      throw new Error("raw bridge stderr: token=secret");
    })).resolves.toEqual({
      ok: false,
      error: { code: "E_INTERNAL", message: "The operation could not be completed" },
    });
  });

  test("allows only the exact renderer URL or dev origin", async () => {
    const security = await import("../electron/ipc-security").catch(() => ({}));

    expect(security).toHaveProperty("isTrustedNavigation");
    const { isTrustedNavigation } = security as {
      isTrustedNavigation(target: string, renderer: string): boolean;
    };
    expect(isTrustedNavigation(
      "file:///Applications/Ralphy/dist/index.html#project",
      "file:///Applications/Ralphy/dist/index.html",
    )).toBe(true);
    expect(isTrustedNavigation(
      "file:///tmp/index.html",
      "file:///Applications/Ralphy/dist/index.html",
    )).toBe(false);
    expect(isTrustedNavigation(
      "http://localhost:5173/workspace",
      "http://localhost:5173",
    )).toBe(true);
    expect(isTrustedNavigation(
      "https://attacker.example/",
      "http://localhost:5173",
    )).toBe(false);
  });

  test("accepts only the active main frame and denies permissions", async () => {
    const security = await import("../electron/ipc-security");
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents };

    expect(() => security.assertTrustedSender({
      sender: webContents,
      senderFrame: mainFrame,
    }, window)).not.toThrow();
    expect(() => security.assertTrustedSender({
      sender: webContents,
      senderFrame: {},
    }, window)).toThrow("Untrusted");
    expect(security).toHaveProperty("denyPermissionRequest");
    const callback = vi.fn();
    (security as typeof security & {
      denyPermissionRequest(
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ): void;
    }).denyPermissionRequest(webContents, "camera", callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  test("creates sandboxed isolated renderer preferences", async () => {
    const security = await import("../electron/ipc-security");
    expect(security).toHaveProperty("secureWebPreferences");
    const preferences = (security as typeof security & {
      secureWebPreferences(preload: string): Record<string, unknown>;
    }).secureWebPreferences("/app/preload.cjs");

    expect(preferences).toEqual({
      preload: "/app/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  test("preload exposes an explicit method allowlist", async () => {
    vi.resetModules();
    let exposed: unknown;
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld(_name: string, value: unknown) {
          exposed = value;
        },
      },
      ipcRenderer: {
        invoke: vi.fn(async () => ({ ok: true, value: null })),
        send: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    }));

    await import("../electron/preload");

    expect(exposed).toBeTypeOf("object");
    expect(Object.keys(exposed as object)).not.toContain("request");
    expect(Object.keys(exposed as object)).toEqual(expect.arrayContaining([
      "restoreLibrary",
      "chooseLibrary",
      "copyMigrationRecoveryCommand",
      "sendAgentMessage",
      "createTerminal",
    ]));
  });

  test("never enables renderer mocks in production without an explicit flag", async () => {
    const ipc = await import("../src/lib/ipc");
    expect(ipc).toHaveProperty("mockBridgeAllowed");
    const { mockBridgeAllowed } = ipc as typeof ipc & {
      mockBridgeAllowed(environment: Record<string, string | boolean | undefined>): boolean;
    };

    expect(mockBridgeAllowed({ MODE: "production" })).toBe(false);
    expect(mockBridgeAllowed({ MODE: "development" })).toBe(false);
    expect(mockBridgeAllowed({
      MODE: "production",
      VITE_RALPHY_ENABLE_MOCKS: "true",
    })).toBe(true);
    expect(mockBridgeAllowed({ MODE: "test" })).toBe(true);
  });
});
