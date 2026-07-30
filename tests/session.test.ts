import { describe, expect, test, vi } from "vitest";
import {
  ActiveRootResource,
  MediaSessionState,
  sendIfWindowAlive,
  StaleMediaSessionError,
  stopMediaRuntime,
} from "../electron/media/session";

describe("media session lifecycle", () => {
  test("rejects callbacks from the previous root without invalidating the current catalog", () => {
    const state = new MediaSessionState();
    const firstRoot = "/tmp/first/.ralphy";
    const secondRoot = "/tmp/second/.ralphy";
    state.activateRoot(firstRoot);
    const firstGeneration = state.beginCatalog(firstRoot);
    state.activateRoot(secondRoot);
    const secondGeneration = state.beginCatalog(secondRoot);

    expect(() => state.beginCatalog(firstRoot)).toThrow(StaleMediaSessionError);
    expect(() => state.acceptCatalog(firstRoot, firstGeneration)).toThrow(StaleMediaSessionError);
    expect(() => state.acceptCatalog(secondRoot, secondGeneration)).not.toThrow();
  });

  test("does not let a stale open replace the current watcher or setting", async () => {
    const state = new MediaSessionState();
    const resources = new ActiveRootResource<{
      start(): Promise<boolean>;
      close(): void;
    }>();
    const firstRoot = "/tmp/first/.ralphy";
    const secondRoot = "/tmp/second/.ralphy";
    let releaseFirstStart: ((started: boolean) => void) | undefined;
    const first = {
      start: vi.fn(() => new Promise<boolean>((resolve) => {
        releaseFirstStart = resolve;
      })),
      close: vi.fn(),
    };
    const second = {
      start: vi.fn(async () => true),
      close: vi.fn(),
    };
    const persisted: string[] = [];

    state.activateRoot(firstRoot);
    const firstOpen = resources.replace(
      state,
      firstRoot,
      () => first,
      async () => {
        persisted.push(firstRoot);
      },
    );
    await Promise.resolve();
    expect(first.start).toHaveBeenCalledOnce();

    resources.close();
    state.activateRoot(secondRoot);
    const secondOpen = resources.replace(
      state,
      secondRoot,
      () => second,
      async () => {
        persisted.push(secondRoot);
      },
    );
    releaseFirstStart?.(true);

    await expect(firstOpen).rejects.toThrow(StaleMediaSessionError);
    await secondOpen;
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.start).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(persisted).toEqual([secondRoot]);
  });

  test("preserves the selected scan policy for watcher refreshes", () => {
    const state = new MediaSessionState();
    const root = "/tmp/current/.ralphy";
    state.activateRoot(root);
    state.beginProject(
      { workspaceId: "studio", projectId: "alpha-001" },
      { includeIntermediate: true },
    );

    expect(state.scanOptionsForWatcher(root)).toEqual({ includeIntermediate: true });
    state.deselectProject();
    expect(state.scanOptionsForWatcher(root)).toBeNull();
  });

  test("deselects before abort and prevents watchers from reviving the project", () => {
    const state = new MediaSessionState();
    const root = "/tmp/current/.ralphy";
    state.activateRoot(root);
    state.beginProject({ workspaceId: "studio", projectId: "alpha-001" });
    const clearFileAccess = vi.spyOn(state.fileAccess, "clear");
    const watcher = { close: vi.fn() };
    const worker = {
      cancelProject: vi.fn(() => {
        expect(state.selectedForWatcher(root)).toBeNull();
      }),
      close: vi.fn(),
    };

    stopMediaRuntime(state, { watcher, worker });

    expect(watcher.close).toHaveBeenCalledOnce();
    expect(worker.cancelProject).toHaveBeenCalledOnce();
    expect(worker.close).toHaveBeenCalledOnce();
    expect(clearFileAccess).toHaveBeenCalledOnce();
    expect(state.selectedForWatcher(root)).toBeNull();
    expect(() => state.requireRoot()).toThrow(/active/i);
  });

  test("does not emit to a destroyed window or destroyed web contents", () => {
    const send = vi.fn();
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => false, send },
    };
    const destroyedContents = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => true, send },
    };

    expect(sendIfWindowAlive(destroyedWindow, "media:event", {})).toBe(false);
    expect(sendIfWindowAlive(destroyedContents, "media:event", {})).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
