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
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import {
  ActiveRootResource,
  MediaSessionState,
  sendIfWindowAlive,
  StaleMediaSessionError,
  stopMediaRuntime,
} from "./media/session";
import { ClaudeSession, detectClaude, type AgentEvent } from "./claude/session";

const REPO_ROOT = join(__dirname, "..", "..");
const RENDERER = join(__dirname, "..", "dist", "index.html");
const WORKER_ENTRY = join(__dirname, "media", "worker.cjs");
const SETTINGS_LIMIT_BYTES = 64 * 1024;
const CLIPBOARD_LIMIT = 2 * 1024 * 1024;
const MAX_TRASH_ITEMS = 1000;

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
let session: ClaudeSession | null = null;
let authMethod: "subscription" | "api-key" | null = null;
const mediaState = new MediaSessionState();
const watcher = new ActiveRootResource<LibraryWatcher>();

function emitMedia(event: MediaEvent): void {
  sendIfWindowAlive(win, MEDIA_CHANNELS.event, event);
}

function emitAgent(event: AgentEvent): void {
  sendIfWindowAlive(win, "agent:event", event);
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

async function readSettings(): Promise<AppSettings> {
  const path = settingsPath();
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size > SETTINGS_LIMIT_BYTES) return { lastLibrary: null };
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (value !== null && typeof value === "object") {
      const lastLibrary = (value as Record<string, unknown>).lastLibrary;
      return { lastLibrary: typeof lastLibrary === "string" ? lastLibrary : null };
    }
  } catch {
    // Invalid app-local state is treated as no restoration.
  }
  return { lastLibrary: null };
}

async function writeSettings(settings: AppSettings): Promise<void> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function requireActiveRoot(): string {
  return mediaState.requireRoot();
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

async function refreshCatalog(rootPath = requireActiveRoot()): Promise<CatalogResult> {
  const generation = mediaState.beginCatalog(rootPath);
  const result = await mediaWorker().catalog(rootPath, generation);
  mediaState.acceptCatalog(rootPath, generation);
  emitMedia({ type: "catalog-result", result });
  return result;
}

async function scanSelectedProject(
  project: ProjectReference,
  options: ProjectScanQuery = {},
): Promise<ProjectScanResult> {
  const rootPath = requireActiveRoot();
  await resolveProjectPath(rootPath, project.workspaceId, project.projectId);
  const request = mediaState.beginProject(project, options);
  try {
    const result = await mediaWorker().scanProject(request);
    mediaState.acceptProject(request, result);
    emitMedia({ type: "project-result", result });
    return result;
  } catch (error) {
    if (error instanceof ScanRequestCancelledError) {
      emitMedia({ type: "project-cancelled", request });
    }
    throw error;
  }
}

function createWatcher(rootPath: string): LibraryWatcher {
  return new LibraryWatcher({
    rootPath,
    selectedProject: () => mediaState.selectedForWatcher(rootPath),
    onCatalogChange() {
      void refreshCatalog(rootPath).catch((error: unknown) => {
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
      const project = mediaState.selectedForWatcher(rootPath);
      const options = mediaState.scanOptionsForWatcher(rootPath);
      if (!project || !options) return;
      void scanSelectedProject(project, options).catch((error: unknown) => {
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

async function openLibrary(rootPath: string): Promise<LibraryOpenResult> {
  const root = await validateLibraryRoot(rootPath);
  watcher.close();
  mediaState.activateRoot(root);
  worker?.cancelProject();
  const catalog = await refreshCatalog(root);
  await watcher.replace(
    mediaState,
    root,
    () => createWatcher(root),
    () => writeSettings({ lastLibrary: root }),
  );
  return { rootPath: root, catalog };
}

async function mediaUrl(path: string): Promise<string> {
  const root = requireActiveRoot();
  const token = await mediaState.fileAccess.mint(root, path);
  return `ralphy-media://asset/${token}`;
}

function registerMediaIpc(): void {
  ipcMain.handle(MEDIA_CHANNELS.chooseLibrary, async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose Ralphy Library",
      message: "Choose a .ralphy directory",
      properties: ["openDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : openLibrary(result.filePaths[0]);
  });
  ipcMain.handle(MEDIA_CHANNELS.restoreLibrary, async () => {
    const { lastLibrary } = await readSettings();
    if (!lastLibrary) return null;
    try {
      return await openLibrary(lastLibrary);
    } catch {
      return null;
    }
  });
  ipcMain.handle(MEDIA_CHANNELS.openLibrary, (_event, rootPath: unknown) => (
    openLibrary(parseString(rootPath, "library path"))
  ));
  ipcMain.handle(MEDIA_CHANNELS.scanProject, (_event, project: unknown, options: unknown) => (
    scanSelectedProject(parseProjectReference(project), parseProjectScanQuery(options))
  ));
  ipcMain.handle(MEDIA_CHANNELS.cancelProjectScan, () => {
    mediaState.deselectProject();
    worker?.cancelProject();
  });
  ipcMain.handle(MEDIA_CHANNELS.loadAnnotations, () => loadAnnotations(requireActiveRoot()));
  ipcMain.handle(MEDIA_CHANNELS.updateAnnotations, (_event, updates: unknown) => (
    updateAnnotations(requireActiveRoot(), updates)
  ));
  ipcMain.handle(MEDIA_CHANNELS.trashItems, (_event, rawPaths: unknown) => {
    if (
      !Array.isArray(rawPaths)
      || rawPaths.length > MAX_TRASH_ITEMS
      || !rawPaths.every((path) => typeof path === "string")
    ) {
      throw new Error("Invalid Trash paths");
    }
    const paths = rawPaths.map((path) => parseString(path, "Trash path"));
    const root = requireActiveRoot();
    return trashAuthorizedItems(
      root,
      paths,
      mediaState.fileAccess,
      (path) => shell.trashItem(path),
    );
  });
  ipcMain.handle(MEDIA_CHANNELS.showInFinder, async (_event, rawPath: unknown) => {
    const root = requireActiveRoot();
    const path = await mediaState.fileAccess.resolveFile(
      root,
      parseString(rawPath, "Finder path"),
    );
    shell.showItemInFolder(path);
  });
  ipcMain.handle(MEDIA_CHANNELS.openExternal, async (_event, rawPath: unknown) => {
    const root = requireActiveRoot();
    const path = await mediaState.fileAccess.resolveFile(
      root,
      parseString(rawPath, "external path"),
    );
    return shell.openPath(path);
  });
  ipcMain.handle(MEDIA_CHANNELS.copyText, (_event, rawText: unknown) => {
    const text = parseString(rawText, "clipboard text", CLIPBOARD_LIMIT);
    clipboard.writeText(text);
  });
  ipcMain.handle(
    MEDIA_CHANNELS.readText,
    (_event, rawPath: unknown, rawMaxBytes?: unknown) => {
      const maxBytes = typeof rawMaxBytes === "number" && Number.isFinite(rawMaxBytes)
        ? rawMaxBytes
        : undefined;
      const root = requireActiveRoot();
      return mediaState.fileAccess.resolveFile(
        root,
        parseString(rawPath, "text path"),
        ["text"],
      ).then((path) => readBoundedText(root, path, maxBytes));
    },
  );
  ipcMain.handle(MEDIA_CHANNELS.getMediaUrl, (_event, rawPath: unknown) => (
    mediaUrl(parseString(rawPath, "media path"))
  ));
}

function registerLegacyAgentIpc(): void {
  ipcMain.handle("auth:get", async () => {
    const detected = await detectClaude();
    return {
      method: authMethod,
      claudeBinaryReady: detected.ready,
      apiKeyInEnv: detected.apiKeyInEnv,
    };
  });
  ipcMain.handle("auth:set", (_event, method: "subscription" | "api-key") => {
    authMethod = method;
  });
  ipcMain.handle("agent:send", async (_event, prompt: string) => {
    if (!session) {
      session = new ClaudeSession({
        projectDir: REPO_ROOT,
        preferSubscription: authMethod === "subscription",
        onEvent: emitAgent,
      });
    }
    await session.send(prompt);
  });
}

function createWindow(): void {
  const createdWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#121212",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win = createdWindow;
  createdWindow.on("closed", () => {
    if (win === createdWindow) win = null;
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void createdWindow.loadURL(devUrl);
  else void createdWindow.loadFile(RENDERER);
}

function stopBackgroundResources(): void {
  stopMediaRuntime(mediaState, { watcher, worker });
  worker = null;
  session?.stop();
  session = null;
}

registerMediaIpc();
registerLegacyAgentIpc();

void app.whenReady().then(() => {
  protocol.handle("ralphy-media", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "asset") return new Response("Not found", { status: 404 });
    const token = url.pathname.slice(1);
    try {
      const root = requireActiveRoot();
      const safePath = await mediaState.fileAccess.resolve(root, token);
      return net.fetch(pathToFileURL(safePath).toString());
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
