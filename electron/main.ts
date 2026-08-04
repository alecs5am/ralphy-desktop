import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  nativeImage,
  protocol,
  safeStorage,
  screen,
  session as electronSession,
  shell,
} from "electron";
import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodePty from "node-pty";
import {
  ClaudeCredentialStore,
  EncryptedCredentialStore,
  validateAnthropicApiKey,
  validateOpenRouterApiKey,
} from "./claude/credentials";
import { parseAgentChatRequest } from "./agent/request";
import {
  CodexSession,
  loginCodex,
  readCodexAuthStatus,
  resolveCodexBinary,
} from "./agent/codex-session";
import {
  CLAUDE_MODELS,
  fetchOpenRouterModels,
  readCodexModels,
} from "./agent/models";
import {
  ClaudeSession,
  claudeSubscriptionEnvironment,
  loginClaudeSubscription,
  readClaudeAuthStatus,
  resolveClaudeBinary,
} from "./claude/session";
import { loadAnnotations, updateAnnotations } from "./media/annotations";
import {
  InvalidLibraryRootError,
  readBoundedText,
  resolveProjectPath,
  validateLibraryRoot,
} from "./media/catalog";
import {
  AGENT_CHANNELS,
  APP_CHANNELS,
  MEDIA_CHANNELS,
  MAX_WAVEFORM_DECODE_BYTES,
  TERMINAL_CHANNELS,
  type CatalogResult,
  type AgentChatEnvelope,
  type AgentProvider,
  type AgentProviderStatus,
  type ClaudeAuthState,
  type LibraryOpenResult,
  type MediaEvent,
  type MediaPreviewSource,
  type ProjectReference,
  type ProjectScanQuery,
  type ProjectScanRequest,
  type ProjectScanResult,
  type TerminalDimensions,
  type WorkerRequest,
  type WorkerResponse,
} from "./media/types";
import { LibraryWatcher } from "./media/watcher";
import { ScanRequestCancelledError } from "./media/worker";
import {
  resolveMediaByteRange,
  trashAuthorizedItems,
} from "./media/protocol-access";
import { guardedAtomicWrite } from "./media/atomic-write";
import {
  ActiveRootResource,
  type ActiveMediaSession,
  createSingleFlight,
  guardedResult,
  guardedSideEffect,
  type MediaSessionEpoch,
  MediaSessionState,
  sendIfWindowAlive,
  StaleMediaSessionError,
  stopMediaRuntime,
} from "./media/session";
import { TerminalManager } from "./terminal/manager";
import { resolveRalphyExecutable } from "./ralphy/executable";
import { RalphySession } from "./ralphy/session";
import { openRootSession, type RootIdentity } from "./root-session";
import {
  findMigrationRecovery,
  migrationRecoveryFromError,
  recoveryCommand,
  type MainMigrationRecovery,
} from "./migration-recovery";
import {
  assertTrustedSender as assertIpcSender,
  denyPermissionRequest,
  installNavigationGuards,
  secureWebPreferences,
  toIpcResult,
} from "./ipc-security";
import {
  fitWindowBounds,
  parseWindowBounds,
  type WindowBounds,
} from "./window-state";

const RENDERER = join(__dirname, "..", "dist", "index.html");
const WORKER_ENTRY = join(__dirname, "media", "worker.cjs");
const SETTINGS_LIMIT_BYTES = 64 * 1024;
const WINDOW_STATE_LIMIT_BYTES = 1024;
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 };
const MINIMUM_WINDOW_SIZE = { width: 1100, height: 720 };
const CLIPBOARD_LIMIT = 2 * 1024 * 1024;
const MAX_TRASH_ITEMS = 1000;
const SMOKE_TEST = process.argv.includes("--smoke-test");
let cachedFileDragIcon: Electron.NativeImage | null = null;
let claudeCredentialStore: ClaudeCredentialStore | null = null;
let openRouterCredentialStore: EncryptedCredentialStore | null = null;
let activeAgentSession: { stop(): void } | null = null;
let agentTurnBusy = false;
let cachedOpenRouterModels: { at: number; models: AgentProviderStatus["models"] } | null = null;
const ralphyBin = resolveRalphyExecutable({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  env: process.env,
});
const ralphySession = new RalphySession(ralphyBin ? { bin: ralphyBin } : {});
let migrationRecovery: MainMigrationRecovery | null = null;

function fileDragIcon(): Electron.NativeImage {
  if (cachedFileDragIcon) return cachedFileDragIcon;
  const candidates = [
    join(process.resourcesPath, "RalphyMedia-drag.png"),
    join(__dirname, "..", "assets", "app-icon-1024.png"),
  ];
  for (const path of candidates) {
    const icon = nativeImage.createFromPath(path);
    if (!icon.isEmpty()) {
      cachedFileDragIcon = icon.resize({ width: 48, height: 48 });
      return cachedFileDragIcon;
    }
  }
  throw new Error("Native drag icon is unavailable");
}

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
const terminalManager = new TerminalManager({
  spawn: (file, args, options) => nodePty.spawn(file, args, options),
  emit: (event) => sendIfWindowAlive(win, TERMINAL_CHANNELS.event, event),
});

function credentialStore(): ClaudeCredentialStore {
  if (!claudeCredentialStore) {
    claudeCredentialStore = new ClaudeCredentialStore({
      path: join(app.getPath("userData"), "claude-api-key.bin"),
      cipher: safeStorage,
    });
  }
  return claudeCredentialStore;
}

function openRouterStore(): EncryptedCredentialStore {
  if (!openRouterCredentialStore) {
    openRouterCredentialStore = new EncryptedCredentialStore({
      path: join(app.getPath("userData"), "openrouter-api-key.bin"),
      cipher: safeStorage,
      validate: validateOpenRouterApiKey,
    });
  }
  return openRouterCredentialStore;
}

function inheritedAnthropicApiKey(): string | null {
  try {
    return validateAnthropicApiKey(process.env.ANTHROPIC_API_KEY ?? "");
  } catch {
    return null;
  }
}

function inheritedOpenRouterApiKey(): string | null {
  try {
    return validateOpenRouterApiKey(process.env.OPENROUTER_API_KEY ?? "");
  } catch {
    return null;
  }
}

async function openRouterModels(apiKey?: string): Promise<AgentProviderStatus["models"]> {
  if (cachedOpenRouterModels && Date.now() - cachedOpenRouterModels.at < 5 * 60_000) {
    return cachedOpenRouterModels.models;
  }
  const models = await fetchOpenRouterModels(
    (input, init) => net.fetch(
      typeof input === "string" || input instanceof Request ? input : input.toString(),
      init,
    ),
    apiKey,
  ).catch(() => []);
  if (models.length > 0) cachedOpenRouterModels = { at: Date.now(), models };
  return models;
}

async function claudeAuthState(binary?: string | null): Promise<ClaudeAuthState> {
  const resolvedBinary = binary === undefined ? await resolveClaudeBinary() : binary;
  let subscriptionLoggedIn = false;
  let subscriptionAuthMethod: string | null = null;
  if (resolvedBinary) {
    try {
      const status = await readClaudeAuthStatus(
        resolvedBinary,
        claudeSubscriptionEnvironment(process.env),
      );
      subscriptionLoggedIn = status.loggedIn;
      subscriptionAuthMethod = status.loggedIn ? status.authMethod : null;
    } catch {
      // A missing or expired Claude login is represented as disconnected state.
    }
  }
  const inheritedApiKey = inheritedAnthropicApiKey() !== null;
  return {
    binaryReady: resolvedBinary !== null,
    subscriptionLoggedIn,
    subscriptionAuthMethod,
    apiKeyConfigured: inheritedApiKey || await credentialStore().has(),
    inheritedApiKey,
  };
}

async function agentProviderStatuses(): Promise<AgentProviderStatus[]> {
  const [claude, codexBinary] = await Promise.all([
    claudeAuthState(),
    resolveCodexBinary(),
  ]);
  const codexStatus = codexBinary
    ? await readCodexAuthStatus(codexBinary).catch(() => null)
    : null;
  const codexModels = codexBinary
    ? await readCodexModels(join(app.getPath("home"), ".codex", "models_cache.json"))
    : [];
  const inheritedOpenRouterKey = inheritedOpenRouterApiKey();
  const storedOpenRouterKey = await openRouterStore().read();
  const openRouterKey = storedOpenRouterKey ?? inheritedOpenRouterKey ?? undefined;
  const routerModels = await openRouterModels(openRouterKey);

  const claudeConnected = claude.subscriptionLoggedIn || claude.apiKeyConfigured;
  const codexConnected = codexBinary !== null && codexStatus?.loggedIn === true;
  const routerConnected = codexBinary !== null && Boolean(openRouterKey);
  return [
    {
      id: "claude",
      label: "Claude",
      binaryReady: claude.binaryReady,
      accountConnected: claude.subscriptionLoggedIn,
      apiKeyConfigured: claude.apiKeyConfigured,
      inheritedApiKey: claude.inheritedApiKey,
      connected: claude.binaryReady && claudeConnected,
      detail: claude.subscriptionLoggedIn
        ? `Signed in with ${claude.subscriptionAuthMethod ?? "Claude"}`
        : claude.apiKeyConfigured ? "Anthropic API key ready" : "Claude login required",
      models: CLAUDE_MODELS,
      defaultModel: "sonnet",
    },
    {
      id: "codex",
      label: "Codex",
      binaryReady: codexBinary !== null,
      accountConnected: codexStatus?.loggedIn === true,
      apiKeyConfigured: false,
      inheritedApiKey: false,
      connected: codexConnected,
      detail: codexStatus?.detail ?? (codexBinary ? "Codex login required" : "Codex CLI not found"),
      models: codexModels,
      defaultModel: "default",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      binaryReady: codexBinary !== null,
      accountConnected: false,
      apiKeyConfigured: Boolean(openRouterKey),
      inheritedApiKey: inheritedOpenRouterKey !== null,
      connected: routerConnected,
      detail: openRouterKey ? "OpenRouter API key ready" : "OpenRouter API key required",
      models: routerModels,
      defaultModel: routerModels[0]?.id ?? "~openai/gpt-latest",
    },
  ];
}

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

function windowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function readWindowBounds(): WindowBounds | null {
  const path = windowStatePath();
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > WINDOW_STATE_LIMIT_BYTES) return null;
    return parseWindowBounds(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

async function writeWindowBounds(bounds: WindowBounds): Promise<void> {
  const path = windowStatePath();
  await mkdir(dirname(path), { recursive: true });
  await guardedAtomicWrite(path, `${JSON.stringify(bounds)}\n`, {
    maxBytes: WINDOW_STATE_LIMIT_BYTES,
  });
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

function parseTerminalDimensions(value: unknown): TerminalDimensions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal dimensions");
  }
  const { cols, rows } = value as Record<string, unknown>;
  if (typeof cols !== "number" || typeof rows !== "number") {
    throw new Error("Invalid terminal dimensions");
  }
  return { cols, rows };
}

function captureBridgeRoot(): { rootPath: string; storeId: string; epoch: number } {
  const rootPath = ralphySession.root;
  const hello = ralphySession.hello;
  if (!rootPath || !hello) throw new Error("No active Ralphy library");
  return { rootPath, storeId: hello.storeId, epoch: ralphySession.rootEpoch };
}

function assertBridgeRoot(binding: { rootPath: string; storeId: string; epoch: number }): void {
  if (
    ralphySession.root !== binding.rootPath
    || ralphySession.hello?.storeId !== binding.storeId
    || ralphySession.rootEpoch !== binding.epoch
  ) throw new StaleMediaSessionError();
}

function assertTrustedSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): void {
  assertIpcSender(event, win);
}

function securedHandle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => toIpcResult(() => {
    assertTrustedSender(event);
    return listener(event, ...args);
  }));
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

async function prepareMediaRoot(root: string): Promise<CatalogResult> {
  const operation = mediaState.beginOpen();
  worker?.cancelProject();
  try {
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
    return catalog;
  } catch (error) {
    mediaState.abortOpen(operation);
    throw error;
  }
}

async function openLibrary(
  rootPath: string,
): Promise<LibraryOpenResult> {
  const interrupted = await findMigrationRecovery(rootPath);
  if (interrupted) throw new MigrationRecoveryRequired(interrupted);
  const root = await validateLibraryRoot(rootPath);

  let identity: RootIdentity;
  let catalog: CatalogResult | null = null;
  try {
    identity = await openRootSession({
      session: ralphySession,
      root,
      label: basename(dirname(root)) || ".ralphy",
      prepare: async (previousRoot) => {
        catalog = await prepareMediaRoot(root);
        return async () => {
          if (previousRoot) {
            await prepareMediaRoot(previousRoot);
            return;
          }
          mediaState.close();
          watcher.close();
          worker?.cancelProject();
          await writeSettings({ lastLibrary: null }, () => undefined);
        };
      },
      invalidateFileTokens: () => mediaState.fileAccess.clear(),
      stopAgentTurns: () => activeAgentSession?.stop(),
      terminateTerminals: (previousRoot) => terminalManager.terminateRoot(previousRoot),
      subscribeActivity: async (_client, afterSequence) => {
        await ralphySession.client.request("activity.subscribe", { afterSequence }).catch(() => {
          emitMedia({
            type: "error",
            operation: "activity-subscribe",
            message: "Live activity updates are unavailable",
          });
        });
      },
    });
  } catch (error) {
    const recovery = migrationRecoveryFromError(error);
    if (recovery) throw new MigrationRecoveryRequired(recovery);
    throw error;
  }
  if (!catalog) throw new Error("Library startup did not produce a catalog");
  migrationRecovery = null;
  emitMedia({ type: "root-ready", identity });
  emitMedia({ type: "catalog-result", result: catalog });
  return { identity, catalog };
}

class MigrationRecoveryRequired extends Error {
  constructor(readonly recovery: MainMigrationRecovery) {
    super("Migration recovery required");
    this.name = "MigrationRecoveryRequired";
  }
}

function showMigrationRecovery(recovery: MainMigrationRecovery): void {
  migrationRecovery = recovery;
  emitMedia({
    type: "migration-recovery",
    recovery: { runId: recovery.runId, phase: recovery.phase },
  });
}

function parseAgentProvider(value: unknown, allowed: AgentProvider[]): AgentProvider {
  if (typeof value === "string" && allowed.includes(value as AgentProvider)) {
    return value as AgentProvider;
  }
  throw new Error("Invalid agent provider");
}

function registerAgentIpc(): void {
  securedHandle(AGENT_CHANNELS.providers, async (event) => {
    assertTrustedSender(event);
    return agentProviderStatuses();
  });
  securedHandle(AGENT_CHANNELS.login, async (event, rawProvider: unknown) => {
    assertTrustedSender(event);
    const provider = parseAgentProvider(rawProvider, ["claude", "codex"]);
    if (provider === "claude") {
      const binary = await resolveClaudeBinary();
      if (!binary) throw new Error("Install the Claude CLI before signing in");
      await loginClaudeSubscription(binary);
    } else {
      const binary = await resolveCodexBinary();
      if (!binary) throw new Error("Install the Codex CLI before signing in");
      await loginCodex(binary);
    }
    return agentProviderStatuses();
  });
  securedHandle(
    AGENT_CHANNELS.setApiKey,
    async (event, rawProvider: unknown, rawApiKey: unknown) => {
      assertTrustedSender(event);
      const provider = parseAgentProvider(rawProvider, ["claude", "openrouter"]);
      const apiKey = parseString(rawApiKey, `${provider} API key`, 512);
      if (provider === "claude") await credentialStore().write(apiKey);
      else {
        await openRouterStore().write(apiKey);
        cachedOpenRouterModels = null;
      }
      return agentProviderStatuses();
    },
  );
  securedHandle(AGENT_CHANNELS.clearApiKey, async (event, rawProvider: unknown) => {
    assertTrustedSender(event);
    const provider = parseAgentProvider(rawProvider, ["claude", "openrouter"]);
    if (provider === "claude") await credentialStore().clear();
    else {
      await openRouterStore().clear();
      cachedOpenRouterModels = null;
    }
    return agentProviderStatuses();
  });
  securedHandle(AGENT_CHANNELS.send, async (event, rawRequest: unknown) => {
    assertTrustedSender(event);
    if (agentTurnBusy) throw new Error("An agent is already working");
    agentTurnBusy = true;
    try {
      const operation = captureBridgeRoot();
      const request = parseAgentChatRequest(rawRequest);
      const projectPath = request.project
        ? await resolveProjectPath(
          operation.rootPath,
          request.project.workspaceId,
          request.project.projectId,
        )
        : undefined;
      assertBridgeRoot(operation);
      const emit = (chatEvent: AgentChatEnvelope["event"]): void => {
        const envelope: AgentChatEnvelope = {
          storeId: operation.storeId,
          chatId: request.chatId,
          provider: request.provider,
          event: chatEvent,
        };
        sendIfWindowAlive(win, AGENT_CHANNELS.event, envelope);
      };

      if (request.provider === "claude") {
        const binary = await resolveClaudeBinary();
        if (!binary) throw new Error("Claude CLI is not installed");
        let apiKey: string | undefined;
        if (request.claudeAuthMethod === "api-key") {
          apiKey = await credentialStore().read() ?? inheritedAnthropicApiKey() ?? undefined;
          if (!apiKey) throw new Error("Add an Anthropic API key before sending");
        } else {
          const status = await readClaudeAuthStatus(
            binary,
            claudeSubscriptionEnvironment(process.env),
          ).catch(() => null);
          if (!status?.loggedIn) throw new Error("Sign in to Claude before sending");
        }
        assertBridgeRoot(operation);
        const session = new ClaudeSession({ binary, emit });
        activeAgentSession = session;
        try {
          await session.run({
            rootPath: operation.rootPath,
            projectPath,
            prompt: request.prompt,
            model: request.model,
            authMethod: request.claudeAuthMethod,
            apiKey,
            permissionMode: request.permissionMode,
            resumeSessionId: request.resumeSessionId,
          });
        } finally {
          if (activeAgentSession === session) activeAgentSession = null;
        }
        return;
      }

      const binary = await resolveCodexBinary();
      if (!binary) throw new Error("Codex CLI is not installed");
      let openRouterApiKey: string | undefined;
      if (request.provider === "codex") {
        const status = await readCodexAuthStatus(binary).catch(() => null);
        if (!status?.loggedIn) throw new Error("Sign in to Codex before sending");
      } else {
        openRouterApiKey = await openRouterStore().read()
          ?? inheritedOpenRouterApiKey()
          ?? undefined;
        if (!openRouterApiKey) throw new Error("Add an OpenRouter API key before sending");
      }
      assertBridgeRoot(operation);
      const session = new CodexSession({ binary, emit });
      activeAgentSession = session;
      try {
        await session.run({
          rootPath: operation.rootPath,
          projectPath,
          prompt: request.prompt,
          provider: request.provider,
          model: request.model,
          openRouterApiKey,
          permissionMode: request.permissionMode,
          resumeSessionId: request.resumeSessionId,
        });
      } finally {
        if (activeAgentSession === session) activeAgentSession = null;
      }
    } finally {
      agentTurnBusy = false;
    }
  });
  securedHandle(AGENT_CHANNELS.stop, (event) => {
    assertTrustedSender(event);
    activeAgentSession?.stop();
  });
}

async function mediaUrl(
  operation: ActiveMediaSession,
  path: string,
): Promise<MediaPreviewSource> {
  const assertCurrent = (): void => mediaState.assertActive(operation);
  const { token, sizeBytes } = await mediaState.fileAccess.mint(
    operation.rootPath,
    path,
    assertCurrent,
  );
  assertCurrent();
  return { url: `ralphy-media://asset/${token}`, sizeBytes };
}

function registerMediaIpc(): void {
  securedHandle(MEDIA_CHANNELS.chooseLibrary, async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose Ralphy Library",
      message: "Choose a .ralphy directory",
      properties: ["openDirectory"],
    };
    try {
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      return await openLibrary(result.filePaths[0]);
    } catch (error) {
      if (error instanceof MigrationRecoveryRequired) {
        showMigrationRecovery(error.recovery);
        return null;
      }
      throw error;
    }
  });
  securedHandle(MEDIA_CHANNELS.restoreLibrary, () => {
    return restoreLibrary(async () => {
      const root = (await readSettings()).lastLibrary;
      if (!root) return null;
      try {
        return await openLibrary(root);
      } catch (error) {
        if (error instanceof MigrationRecoveryRequired) {
          showMigrationRecovery(error.recovery);
          return null;
        }
        if (error instanceof InvalidLibraryRootError) return null;
        throw error;
      }
    });
  });
  securedHandle(MEDIA_CHANNELS.scanProject, (_event, project: unknown, options: unknown) => {
    const operation = mediaState.beginProjectSelection();
    worker?.cancelProject();
    return scanSelectedProject(
      operation,
      parseProjectReference(project),
      parseProjectScanQuery(options),
    );
  });
  securedHandle(MEDIA_CHANNELS.cancelProjectScan, () => {
    mediaState.cancelProject();
    worker?.cancelProject();
  });
  securedHandle(MEDIA_CHANNELS.loadAnnotations, () => {
    const operation = mediaState.captureActive();
    const assertCurrent = (): void => mediaState.assertActive(operation);
    return guardedResult(
      mediaState,
      operation,
      () => loadAnnotations(operation.rootPath, { assertCurrent }),
    );
  });
  securedHandle(MEDIA_CHANNELS.updateAnnotations, (_event, updates: unknown) => {
    const operation = mediaState.captureActive();
    const assertCurrent = (): void => mediaState.assertActive(operation);
    return guardedResult(
      mediaState,
      operation,
      () => updateAnnotations(operation.rootPath, updates, { assertCurrent }),
    );
  });
  securedHandle(MEDIA_CHANNELS.trashItems, (_event, rawPaths: unknown) => {
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
  securedHandle(MEDIA_CHANNELS.showInFinder, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    const path = parseString(rawPath, "Finder path");
    return guardedSideEffect(
      mediaState,
      operation,
      () => mediaState.fileAccess.resolveFile(operation.rootPath, path),
      (resolvedPath) => shell.showItemInFolder(resolvedPath),
    );
  });
  securedHandle(MEDIA_CHANNELS.openExternal, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    const path = parseString(rawPath, "external path");
    return guardedSideEffect(
      mediaState,
      operation,
      () => mediaState.fileAccess.resolveFile(operation.rootPath, path),
      (resolvedPath) => shell.openPath(resolvedPath),
    );
  });
  securedHandle(MEDIA_CHANNELS.startFileDrag, (event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    const path = parseString(rawPath, "drag path");
    const resolvedPath = mediaState.fileAccess.resolveFileForDrag(
      operation.rootPath,
      path,
    );
    mediaState.assertActive(operation);
    event.sender.startDrag({
      file: resolvedPath,
      icon: fileDragIcon(),
    });
  });
  securedHandle(MEDIA_CHANNELS.copyText, (_event, rawText: unknown) => {
    const text = parseString(rawText, "clipboard text", CLIPBOARD_LIMIT);
    clipboard.writeText(text);
  });
  securedHandle(MEDIA_CHANNELS.copyMigrationRecoveryCommand, () => {
    if (!migrationRecovery) throw new Error("No migration recovery is active");
    clipboard.writeText(recoveryCommand(migrationRecovery));
  });
  securedHandle(
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
  securedHandle(MEDIA_CHANNELS.getMediaUrl, (_event, rawPath: unknown) => {
    const operation = mediaState.captureActive();
    return mediaUrl(operation, parseString(rawPath, "media path"));
  });
}

function registerTerminalIpc(): void {
  securedHandle(TERMINAL_CHANNELS.create, async (event, rawDimensions: unknown) => {
    assertTrustedSender(event);
    const operation = captureBridgeRoot();
    const session = await terminalManager.create(
      operation.rootPath,
      parseTerminalDimensions(rawDimensions),
    );
    try {
      assertBridgeRoot(operation);
      return session;
    } catch (error) {
      terminalManager.kill(session.id);
      throw error;
    }
  });
  securedHandle(
    TERMINAL_CHANNELS.write,
    (_event, rawSessionId: unknown, rawData: unknown) => {
      terminalManager.write(
        parseString(rawSessionId, "terminal session id", 128),
        parseString(rawData, "terminal input", 64 * 1024),
      );
    },
  );
  securedHandle(
    TERMINAL_CHANNELS.resize,
    (_event, rawSessionId: unknown, rawDimensions: unknown) => {
      terminalManager.resize(
        parseString(rawSessionId, "terminal session id", 128),
        parseTerminalDimensions(rawDimensions),
      );
    },
  );
  securedHandle(TERMINAL_CHANNELS.kill, (event, rawSessionId: unknown) => {
    assertTrustedSender(event);
    terminalManager.kill(parseString(rawSessionId, "terminal session id", 128));
  });
}

function createWindow(): void {
  const savedBounds = readWindowBounds();
  const initialBounds = savedBounds
    ? fitWindowBounds(
      savedBounds,
      screen.getDisplayMatching(savedBounds).workArea,
      MINIMUM_WINDOW_SIZE,
    )
    : DEFAULT_WINDOW_SIZE;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const rendererUrl = devUrl ?? pathToFileURL(RENDERER).toString();
  const createdWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: !SMOKE_TEST,
    webPreferences: secureWebPreferences(join(__dirname, "preload.cjs")),
  });
  const persistBounds = (): void => {
    void writeWindowBounds(createdWindow.getNormalBounds()).catch(() => undefined);
  };
  createdWindow.on("resized", persistBounds);
  createdWindow.on("moved", persistBounds);
  createdWindow.on("close", persistBounds);
  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "http:" || target.protocol === "https:") {
        void shell.openExternal(target.toString());
      }
    } catch {
      // Malformed links are ignored at the renderer trust boundary.
    }
    return { action: "deny" };
  });
  installNavigationGuards(createdWindow.webContents, rendererUrl);
  createdWindow.webContents.on("before-input-event", (event, input) => {
    const command = input.meta && !input.alt && !input.control && !input.shift;
    if (
      input.type === "keyDown"
      && command
      && input.key.toLocaleLowerCase() === "r"
    ) {
      event.preventDefault();
      sendIfWindowAlive(createdWindow, APP_CHANNELS.toggleRightPanel, undefined);
    }
  });
  win = createdWindow;
  createdWindow.on("closed", () => {
    if (win === createdWindow) {
      win = null;
      stopBackgroundResources();
    }
  });
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
                || !window.ralphy?.createTerminal
                || !window.ralphy?.getAgentProviders
                || !window.ralphy?.sendAgentMessage
                || !window.ralphy?.onToggleRightPanel
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
            console.log("RALPHY_TERMINAL_BRIDGE_READY");
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
  activeAgentSession?.stop();
  void ralphySession.close();
  stopMediaRuntime(mediaState, { watcher, worker });
  terminalManager.dispose();
  worker = null;
}

registerMediaIpc();
registerTerminalIpc();
registerAgentIpc();

void app.whenReady().then(() => {
  electronSession.defaultSession.setPermissionRequestHandler(denyPermissionRequest);
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
      const info = await stat(safePath);
      assertCurrent();
      if (
        url.searchParams.get("purpose") === "waveform"
        && info.size > MAX_WAVEFORM_DECODE_BYTES
      ) {
        return new Response("Waveform source exceeds the decode limit", {
          status: 413,
        });
      }
      const requestedRange = request.headers.get("range");
      const range = resolveMediaByteRange(requestedRange, info.size);
      if (requestedRange !== null && range === null) {
        return new Response(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${info.size}`,
          },
        });
      }
      const response = await net.fetch(pathToFileURL(safePath).toString(), {
        headers: range
          ? { Range: `bytes=${range.start}-${range.end}` }
          : undefined,
      });
      assertCurrent();
      const headers = new Headers(response.headers);
      headers.set("Accept-Ranges", "bytes");
      headers.set(
        "Content-Length",
        String(range ? range.end - range.start + 1 : info.size),
      );
      if (range) {
        headers.set(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${info.size}`,
        );
      }
      return new Response(response.body, {
        status: range ? 206 : response.status,
        statusText: range ? "Partial Content" : response.statusText,
        headers,
      });
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
