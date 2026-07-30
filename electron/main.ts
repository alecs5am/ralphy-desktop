import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import { mkdir, readFile, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAnnotations, updateAnnotations } from "./media/annotations";
import {
  readBoundedText,
  resolveProjectPath,
  validateLibraryRoot,
} from "./media/catalog";
import {
  MEDIA_CHANNELS,
  type CatalogResult,
  type LibraryOpenResult,
  type MediaEvent,
  type ProjectReference,
  type ProjectScanQuery,
  type ProjectScanRequest,
  type ProjectScanResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./media/types";
import { LibraryWatcher } from "./media/watcher";
import { ScanRequestCancelledError } from "./media/worker";
import { trashAuthorizedItems } from "./media/protocol-access";
import { guardedAtomicWrite } from "./media/atomic-write";
import {
  ActiveRootResource,
  type ActiveMediaSession,
  createSingleFlight,
  guardedResult,
  guardedSideEffect,
  type MediaSessionEpoch,
  MediaSessionState,
  restorePersistedLibrary,
  sendIfWindowAlive,
  StaleMediaSessionError,
  stopMediaRuntime,
} from "./media/session";

const RENDERER = join(__dirname, "..", "dist", "index.html");
const WORKER_ENTRY = join(__dirname, "media", "worker.cjs");
const SETTINGS_LIMIT_BYTES = 64 * 1024;
const CLIPBOARD_LIMIT = 2 * 1024 * 1024;
const MAX_TRASH_ITEMS = 1000;
const SMOKE_TEST = process.argv.includes("--smoke-test");

protocol.registerSchemesAsPrivileged([{
  scheme: "ralphy-media",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

interface PendingWorkerRequest {
  resolve: (value: CatalogResult | ProjectScanResult) => void;
  reject: (error: Error) => void;
}

interface AppSettings {
  lastLibrary: string | null;
}

class MediaWorkerClient {
  readonly #worker: Worker;
  readonly #onMessage: (message: WorkerResponse) => void;
  readonly #pending = new Map<number, PendingWorkerRequest>();
  #nextRequestId = 1;

  constructor(onMessage: (message: WorkerResponse) => void) {
    this.#onMessage = onMessage;
    this.#worker = new Worker(WORKER_ENTRY);
    this.#worker.on("message", (message: WorkerResponse) => this.#handle(message));
    this.#worker.on("error", (error) => this.#failAll(error));
    this.#worker.on("exit", (code) => {
      if (code !== 0) this.#failAll(new Error(`Media worker exited with code ${code}`));
    });
  }

  catalog(rootPath: string, generation: number): Promise<CatalogResult> {
    return this.#request<CatalogResult>((requestId) => ({
      type: "catalog",
      requestId,
      rootPath,
      generation,
    }));
  }

  scanProject(request: ProjectScanRequest): Promise<ProjectScanResult> {
    return this.#request<ProjectScanResult>((requestId) => ({
      type: "scan-project",
      requestId,
      request,
    }));
  }

  cancelProject(): void {
    this.#worker.postMessage({ type: "cancel-project" } satisfies WorkerRequest);
  }

  close(): void {
    this.#failAll(new Error("Media worker closed"));
    void this.#worker.terminate();
  }

  #request<Result extends CatalogResult | ProjectScanResult>(
    message: (requestId: number) => WorkerRequest,
  ): Promise<Result> {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise<Result>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Result),
        reject,
      });
      this.#worker.postMessage(message(requestId));
    });
  }

  #handle(message: WorkerResponse): void {
    if (message.type === "catalog-progress" || message.type === "project-progress") {
      this.#onMessage(message);
      return;
    }
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    this.#pending.delete(message.requestId);
    if (message.type === "catalog-result" || message.type === "project-result") {
      pending.resolve(message.result);
    } else if (message.type === "project-cancelled") {
      pending.reject(new ScanRequestCancelledError());
    } else {
      pending.reject(new Error(message.message));
    }
  }

  #failAll(error: Error): void {
    for (const request of this.#pending.values()) request.reject(error);
    this.#pending.clear();
  }
}

let win: BrowserWindow | null = null;
let worker: MediaWorkerClient | null = null;
const mediaState = new MediaSessionState();
const watcher = new ActiveRootResource<LibraryWatcher>();
const restoreLibrary = createSingleFlight<LibraryOpenResult | null>();

function emitMedia(event: MediaEvent): void {
  sendIfWindowAlive(win, MEDIA_CHANNELS.event, event);
}

function mediaWorker(): MediaWorkerClient {
  if (!worker) {
    worker = new MediaWorkerClient((message) => {
      if (
        message.type === "catalog-progress"
        && mediaState.isCurrentCatalogProgress(message.progress)
      ) {
        emitMedia({ type: "catalog-progress", progress: message.progress });
      } else if (
        message.type === "project-progress"
        && mediaState.isCurrentProject(message.progress)
      ) {
        emitMedia({ type: "project-progress", progress: message.progress });
      }
    });
  }
  return worker;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "media-library-settings.json");
}

async function readSettings(assertCurrent: () => void = () => undefined): Promise<AppSettings> {
  assertCurrent();
  const path = settingsPath();
  const info = await stat(path).catch(() => null);
  assertCurrent();
  if (!info?.isFile() || info.size > SETTINGS_LIMIT_BYTES) return { lastLibrary: null };
  let data: string;
  try {
    data = await readFile(path, "utf8");
  } catch {
    return { lastLibrary: null };
  }
  assertCurrent();
  try {
    const value = JSON.parse(data) as unknown;
    if (value !== null && typeof value === "object") {
      const lastLibrary = (value as Record<string, unknown>).lastLibrary;
      return { lastLibrary: typeof lastLibrary === "string" ? lastLibrary : null };
    }
  } catch {
    // Invalid app-local state is treated as no restoration.
  }
  return { lastLibrary: null };
}

async function writeSettings(
  settings: AppSettings,
  assertCurrent: () => void,
): Promise<void> {
  assertCurrent();
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  assertCurrent();
  await guardedAtomicWrite(
    path,
    `${JSON.stringify(settings, null, 2)}\n`,
    { maxBytes: SETTINGS_LIMIT_BYTES, assertCurrent },
  );
}

function parseString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function parseProjectReference(value: unknown): ProjectReference {
  if (value === null || typeof value !== "object") throw new Error("Invalid project reference");
  const row = value as Record<string, unknown>;
  return {
    workspaceId: parseString(row.workspaceId, "workspace id", 256),
    projectId: parseString(row.projectId, "project id", 256),
  };
}

function parseProjectScanQuery(value: unknown): ProjectScanQuery {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid project scan options");
  }
  const includeIntermediate = (value as Record<string, unknown>).includeIntermediate;
  if (includeIntermediate !== undefined && typeof includeIntermediate !== "boolean") {
    throw new Error("Invalid intermediate scan option");
  }
  return { includeIntermediate };
}

async function refreshCatalog(
  operation: MediaSessionEpoch | ActiveMediaSession,
  rootPath: string,
  emitResult = true,
): Promise<CatalogResult> {
  const generation = mediaState.beginCatalog(operation, rootPath);
  const result = await mediaWorker().catalog(rootPath, generation);
  mediaState.acceptCatalog(operation, rootPath, generation);
  if (emitResult) emitMedia({ type: "catalog-result", result });
  return result;
}

async function scanSelectedProject(
  operation: ActiveMediaSession,
  project: ProjectReference,
  options: ProjectScanQuery = {},
): Promise<ProjectScanResult> {
  mediaState.assertActive(operation);
  const rootPath = operation.rootPath;
  await resolveProjectPath(rootPath, project.workspaceId, project.projectId);
  mediaState.assertActive(operation);
  const request = mediaState.beginProject(operation, project, options);
  try {
    const result = await mediaWorker().scanProject(request);
    mediaState.acceptProject(operation, request, result);
    emitMedia({ type: "project-result", result });
    mediaState.assertActive(operation);
    return result;
  } catch (error) {
    if (
      error instanceof ScanRequestCancelledError
      && mediaState.isCurrentProject(request)
    ) {
      emitMedia({ type: "project-cancelled", request });
    }
    throw error;
  }
}

function createWatcher(rootPath: string): LibraryWatcher {
  return new LibraryWatcher({
    rootPath,
    selectedProject: () => mediaState.watcherSelection(rootPath)?.project ?? null,
    onCatalogChange() {
      let operation: ActiveMediaSession;
      try {
        operation = mediaState.captureActive(rootPath);
      } catch {
        return;
      }
      void refreshCatalog(operation, rootPath).catch((error: unknown) => {
        if (!(error instanceof StaleMediaSessionError)) {
          emitMedia({
            type: "error",
            operation: "catalog-refresh",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    onSelectedProjectChange() {
      const selection = mediaState.watcherSelection(rootPath);
      if (!selection) return;
      void scanSelectedProject(
        selection.operation,
        selection.project,
        selection.options,
      ).catch((error: unknown) => {
        if (
          !(error instanceof StaleMediaSessionError)
          && !(error instanceof ScanRequestCancelledError)
        ) {
          emitMedia({
            type: "error",
            operation: "project-refresh",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    onError(error) {
      if (mediaState.isActiveRoot(rootPath)) {
        emitMedia({ type: "error", operation: "watch", message: error.message });
      }
    },
  });
}

async function openLibrary(
  operation: MediaSessionEpoch,
  rootPath: string,
): Promise<LibraryOpenResult> {
  const root = await validateLibraryRoot(rootPath);
  mediaState.assertOpen(operation);
  const catalog = await refreshCatalog(operation, root, false);
  mediaState.assertOpen(operation);
  const active = await watcher.replace({
    assertCurrent: () => mediaState.assertOpen(operation),
    create: () => createWatcher(root),
    prepare: () => writeSettings(
      { lastLibrary: root },
      () => mediaState.assertOpen(operation),
    ),
    commit: () => mediaState.completeOpen(operation, root),
  });
  mediaState.assertActive(active);
  emitMedia({ type: "catalog-result", result: catalog });
  mediaState.assertActive(active);
  return { rootPath: root, catalog };
}

function beginOpenOperation(): MediaSessionEpoch {
  const operation = mediaState.beginOpen();
  worker?.cancelProject();
  return operation;
}

async function mediaUrl(
  operation: ActiveMediaSession,
  path: string,
): Promise<string> {
  const assertCurrent = (): void => mediaState.assertActive(operation);
  const token = await mediaState.fileAccess.mint(operation.rootPath, path, assertCurrent);
  assertCurrent();
  return `ralphy-media://asset/${token}`;
}

function registerMediaIpc(): void {
  ipcMain.handle(MEDIA_CHANNELS.chooseLibrary, async () => {
    const operation = beginOpenOperation();
    const options: Electron.OpenDialogOptions = {
      title: "Choose Ralphy Library",
      message: "Choose a .ralphy directory",
      properties: ["openDirectory"],
    };
    try {
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      mediaState.assertOpen(operation);
      if (result.canceled || !result.filePaths[0]) {
        mediaState.abortOpen(operation);
        return null;
      }
      return await openLibrary(operation, result.filePaths[0]);
    } catch (error) {
      mediaState.abortOpen(operation);
      throw error;
    }
  });
  ipcMain.handle(MEDIA_CHANNELS.restoreLibrary, () => {
    return restoreLibrary(() => {
      const operation = beginOpenOperation();
      return restorePersistedLibrary(
        mediaState,
        operation,
        async (assertCurrent) => (await readSettings(assertCurrent)).lastLibrary,
        openLibrary,
      );
    });
  });
  ipcMain.handle(MEDIA_CHANNELS.openLibrary, async (_event, rootPath: unknown) => {
    const operation = beginOpenOperation();
    try {
      return await openLibrary(operation, parseString(rootPath, "library path"));
    } catch (error) {
      mediaState.abortOpen(operation);
      throw error;
    }
  });
  ipcMain.handle(MEDIA_CHANNELS.scanProject, (_event, project: unknown, options: unknown) => {
    const operation = mediaState.beginProjectSelection();
    worker?.cancelProject();
    return scanSelectedProject(
      operation,
      parseProjectReference(project),
      parseProjectScanQuery(options),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.cancelProjectScan, () => {
    mediaState.cancelProject();
    worker?.cancelProject();
  });
  ipcMain.handle(MEDIA_CHANNELS.loadAnnotations, () => {
    const operation = mediaState.captureActive();
    const assertCurrent = (): void => mediaState.assertActive(operation);
    return guardedResult(
      mediaState,
      operation,
      () => loadAnnotations(operation.rootPath, { assertCurrent }),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.updateAnnotations, (_event, updates: unknown) => {
    const operation = mediaState.captureActive();
    const assertCurrent = (): void => mediaState.assertActive(operation);
    return guardedResult(
      mediaState,
      operation,
      () => updateAnnotations(operation.rootPath, updates, { assertCurrent }),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.trashItems, (_event, rawPaths: unknown) => {
    const operation = mediaState.captureActive();
    if (
      !Array.isArray(rawPaths)
      || rawPaths.length > MAX_TRASH_ITEMS
      || !rawPaths.every((path) => typeof path === "string")
    ) {
      throw new Error("Invalid Trash paths");
    }
    const paths = rawPaths.map((path) => parseString(path, "Trash path"));
    return trashAuthorizedItems(
      operation.rootPath,
      paths,
      mediaState.fileAccess,
      (path) => shell.trashItem(path),
      () => mediaState.assertActive(operation),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.showInFinder, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    const path = parseString(rawPath, "Finder path");
    return guardedSideEffect(
      mediaState,
      operation,
      () => mediaState.fileAccess.resolveFile(operation.rootPath, path),
      (resolvedPath) => shell.showItemInFolder(resolvedPath),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.openExternal, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    const path = parseString(rawPath, "external path");
    return guardedSideEffect(
      mediaState,
      operation,
      () => mediaState.fileAccess.resolveFile(operation.rootPath, path),
      (resolvedPath) => shell.openPath(resolvedPath),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.copyText, (_event, rawText: unknown) => {
    const text = parseString(rawText, "clipboard text", CLIPBOARD_LIMIT);
    clipboard.writeText(text);
  });
  ipcMain.handle(
    MEDIA_CHANNELS.readText,
    (_event, rawPath: unknown, rawMaxBytes?: unknown) => {
      const operation = mediaState.captureActive();
      const maxBytes = typeof rawMaxBytes === "number" && Number.isFinite(rawMaxBytes)
        ? rawMaxBytes
        : undefined;
      const path = parseString(rawPath, "text path");
      return guardedResult(mediaState, operation, async () => {
        const resolvedPath = await mediaState.fileAccess.resolveFile(
          operation.rootPath,
          path,
          ["text"],
        );
        mediaState.assertActive(operation);
        return readBoundedText(operation.rootPath, resolvedPath, maxBytes);
      });
    },
  );
  ipcMain.handle(MEDIA_CHANNELS.getMediaUrl, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    return mediaUrl(operation, parseString(rawPath, "media path"));
  });
}

function createWindow(): void {
  const createdWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: !SMOKE_TEST,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win = createdWindow;
  createdWindow.on("closed", () => {
    if (win === createdWindow) {
      win = null;
      stopBackgroundResources();
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void createdWindow.loadURL(devUrl);
  else void createdWindow.loadFile(RENDERER);
  if (SMOKE_TEST) {
    createdWindow.webContents.once("did-finish-load", () => {
      void (async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const ready = await createdWindow.webContents.executeJavaScript(
            `(() => {
              if (
                !document.querySelector(".workbench")
                || !window.ralphy?.chooseLibrary
                || !CSS.supports("corner-shape", "squircle")
              ) return false;
              const fixture = document.createElement("div");
              fixture.innerHTML = [
                '<button class="filter-chip">Filter</button>',
                '<button class="structure-row">Row</button>',
                '<div class="project-controls"></div>',
              ].join("");
              document.body.append(fixture);
              const chip = getComputedStyle(fixture.children[0]);
              const row = getComputedStyle(fixture.children[1]);
              const controls = getComputedStyle(fixture.children[2]);
              const valid =
                Number.parseFloat(chip.fontSize) >= 11
                && chip.getPropertyValue("corner-shape").trim() === "round"
                && row.borderBottomWidth === "0px"
                && controls.containerName === "project-controls";
              fixture.remove();
              return valid;
            })()`,
          );
          if (ready) {
            console.log("RALPHY_SMOKE_READY");
            await new Promise((resolveReady) => setTimeout(resolveReady, 100));
            app.exit(0);
            return;
          }
          await new Promise((resolveReady) => setTimeout(resolveReady, 50));
        }
        app.exit(1);
      })().catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
    });
  }
}

function stopBackgroundResources(): void {
  stopMediaRuntime(mediaState, { watcher, worker });
  worker = null;
}

registerMediaIpc();

void app.whenReady().then(() => {
  protocol.handle("ralphy-media", async (request) => {
    try {
      const operation = mediaState.captureActive();
      const assertCurrent = (): void => mediaState.assertActive(operation);
      const url = new URL(request.url);
      if (url.hostname !== "asset") return new Response("Not found", { status: 404 });
      const token = url.pathname.slice(1);
      const safePath = await mediaState.fileAccess.resolve(
        operation.rootPath,
        token,
        assertCurrent,
      );
      assertCurrent();
      const response = await net.fetch(pathToFileURL(safePath).toString());
      assertCurrent();
      return response;
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  });
  createWindow();
});

app.on("window-all-closed", () => {
  stopBackgroundResources();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  stopBackgroundResources();
});
