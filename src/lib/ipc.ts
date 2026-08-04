import type {
  AnnotationInput,
  AnnotationStore,
  AgentChatEnvelope,
  AgentChatRequest,
  CatalogResult,
  ClaudeAuthState,
  GenerationAttribution,
  LibraryOpenResult,
  MediaEntity,
  MediaEvent,
  MediaItem,
  MediaKind,
  MediaWorkbenchBridge,
  ProjectReference,
  ProjectScanQuery,
  ProjectScanResult,
  ProjectSummary,
  TerminalDimensions,
  TerminalEvent,
  TerminalSession,
  WorkspaceSummary,
} from "../../electron/media/types";

export type {
  AgentChatEnvelope,
  AgentChatEvent,
  AgentChatRequest,
  AgentModelOption,
  AgentPermissionMode,
  AgentProvider,
  AgentProviderStatus,
  AnnotationInput,
  AnnotationStore,
  CatalogResult,
  ClaudeAuthMethod,
  ClaudeAuthState,
  ClaudePermissionMode,
  GenerationAttribution,
  LibraryOpenResult,
  MediaAnnotation,
  MediaEntity,
  MediaEvent,
  MediaGroup,
  MediaItem,
  MediaKind,
  MediaQueryOptions,
  MediaWorkbenchBridge,
  MigrationRecovery,
  ProjectReference,
  ProjectMode,
  ProjectScanQuery,
  ProjectScanProgress,
  ProjectScanResult,
  ProjectSummary,
  ReviewStatus,
  RootIdentity,
  TextReadResult,
  TerminalDimensions,
  TerminalEvent,
  TerminalSession,
  TrashResult,
  WorkspaceSummary,
} from "../../electron/media/types";

export type RalphyBridge = MediaWorkbenchBridge;

declare global {
  interface Window {
    ralphy?: RalphyBridge;
  }
}

const MOCK_ROOT = "/Users/demo/ralphy-project/.ralphy";
const MOCK_WORKSPACE = `${MOCK_ROOT}/workspaces/launch-studio`;
const MOCK_PROJECT = `${MOCK_WORKSPACE}/projects/coffee-grinder-001`;

const mockWorkspaces: WorkspaceSummary[] = [
  {
    id: "launch-studio",
    name: "Launch Studio",
    description: "Short-form product launches and creator cuts.",
    absolutePath: MOCK_WORKSPACE,
    projectCount: 3,
    sharedCount: 12,
    unitCount: 8,
    finalCount: 4,
    recentActivity: "2026-07-30T09:42:00.000Z",
  },
  {
    id: "fogtown",
    name: "Fog Town",
    description: "Narrative world, cast references, and episodic reels.",
    absolutePath: `${MOCK_ROOT}/workspaces/fogtown`,
    projectCount: 7,
    sharedCount: 24,
    unitCount: 15,
    finalCount: 9,
    recentActivity: "2026-07-29T18:10:00.000Z",
  },
  {
    id: "archive",
    name: "Archive",
    description: "Completed campaigns retained for reference.",
    absolutePath: `${MOCK_ROOT}/workspaces/archive`,
    projectCount: 18,
    sharedCount: 6,
    unitCount: 31,
    finalCount: 26,
    recentActivity: "2026-07-22T12:00:00.000Z",
  },
];

const mockProjects: ProjectSummary[] = [
  {
    id: "launch-studio/coffee-grinder-001",
    workspaceId: "launch-studio",
    projectId: "coffee-grinder-001",
    name: "Arc Grinder Launch",
    brief: "A tactile 15-second creator review focused on grind consistency.",
    absolutePath: MOCK_PROJECT,
    status: "assets",
    phase: "production",
    finalState: "review",
    platform: "tiktok",
    aspectRatio: "9:16",
    spendUsd: 3.84,
    finalCount: 1,
    sharedCount: 12,
    unitCount: 3,
    recentActivity: "2026-07-30T09:42:00.000Z",
  },
  {
    id: "launch-studio/skin-set-004",
    workspaceId: "launch-studio",
    projectId: "skin-set-004",
    name: "Night Set Unboxing",
    brief: "Warm bathroom-counter unboxing with three product details.",
    absolutePath: `${MOCK_WORKSPACE}/projects/skin-set-004`,
    status: "done",
    phase: "delivery",
    finalState: "ready",
    platform: "instagram",
    aspectRatio: "4:5",
    spendUsd: 6.2,
    finalCount: 2,
    sharedCount: 12,
    unitCount: 3,
    recentActivity: "2026-07-29T16:21:00.000Z",
  },
  {
    id: "launch-studio/trail-shoe-002",
    workspaceId: "launch-studio",
    projectId: "trail-shoe-002",
    name: "Trail Shoe Macro",
    brief: "Mud, tread, and lace detail cuts for a concise paid social spot.",
    absolutePath: `${MOCK_WORKSPACE}/projects/trail-shoe-002`,
    status: "prompts",
    phase: "preflight",
    finalState: "missing",
    platform: "youtube-shorts",
    aspectRatio: "9:16",
    spendUsd: 0.65,
    finalCount: 0,
    sharedCount: 12,
    unitCount: 2,
    recentActivity: "2026-07-28T11:05:00.000Z",
  },
];

function mockGeneration(
  operation: string,
  costUsd: number,
  model: string,
): GenerationAttribution {
  return {
    provider: "openrouter",
    model,
    operation,
    timestamp: "2026-07-30T09:35:00.000Z",
    costUsd,
    slot: operation,
  };
}

function mockItem(
  relativePath: string,
  entity: MediaEntity,
  kind: MediaKind,
  sizeBytes: number,
  generation: GenerationAttribution | null = null,
): MediaItem {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const dot = name.lastIndexOf(".");
  return {
    id: `mock-${relativePath.replaceAll("/", "-")}`,
    workspaceId: "launch-studio",
    projectId: "coffee-grinder-001",
    name,
    absolutePath: `${MOCK_PROJECT}/${relativePath}`,
    projectRelativePath: relativePath,
    entity,
    kind,
    extension: dot >= 0 ? name.slice(dot).toLowerCase() : "",
    sizeBytes,
    modifiedAt: "2026-07-30T09:42:00.000Z",
    generation,
  };
}

const mockItems: MediaItem[] = [
  mockItem("render/final.mp4", "final-render", "video", 18_420_000, mockGeneration("render", 0, "ffmpeg")),
  mockItem(
    "artifacts/images/scene-01-hook.png",
    "generated-artifact",
    "image",
    2_840_000,
    mockGeneration("image", 0.18, "openai/gpt-5.4-image-2"),
  ),
  mockItem(
    "artifacts/videos/scene-01-hook.mp4",
    "generated-artifact",
    "video",
    8_610_000,
    mockGeneration("video", 1.2, "kwaivgi/kling-v3.0-pro"),
  ),
  mockItem(
    "artifacts/images/scene-02-detail.png",
    "generated-artifact",
    "image",
    3_120_000,
    mockGeneration("image", 0.18, "openai/gpt-5.4-image-2"),
  ),
  mockItem(
    "artifacts/videos/scene-02-detail.mp4",
    "generated-artifact",
    "video",
    7_940_000,
    mockGeneration("video", 1.2, "kwaivgi/kling-v3.0-pro"),
  ),
  mockItem("artifacts/refs/grinder-front.jpg", "reference", "image", 1_240_000),
  mockItem("artifacts/refs/counter-lighting.jpg", "reference", "image", 980_000),
  mockItem("units/hero/cut.mp4", "unit-asset", "video", 16_800_000),
  mockItem("BRIEF.md", "lifecycle-document", "text", 2_140),
  mockItem("production-plan.json", "lifecycle-document", "text", 12_480),
  mockItem("STORYBOARD.md", "lifecycle-document", "text", 8_320),
  mockItem("index.html", "production-file", "text", 18_940),
];

function mockCatalog(generation = 1): CatalogResult {
  return {
    rootPath: MOCK_ROOT,
    generation,
    workspaces: mockWorkspaces,
    projects: mockProjects,
    mediaItemCount: 0,
    completedAt: "2026-07-30T09:43:00.000Z",
  };
}

function createMockBridge(): RalphyBridge {
  const mediaCallbacks = new Set<(event: MediaEvent) => void>();
  const terminalCallbacks = new Set<(event: TerminalEvent) => void>();
  const agentCallbacks = new Set<(event: AgentChatEnvelope) => void>();
  let openRouterConfigured = false;
  let claudeAuth: ClaudeAuthState = {
    binaryReady: true,
    subscriptionLoggedIn: true,
    subscriptionAuthMethod: "claude.ai",
    apiKeyConfigured: false,
    inheritedApiKey: false,
  };
  let annotations: AnnotationStore = {
    version: 1,
    items: {
      "mock-artifacts-images-scene-01-hook.png": {
        reviewStatus: "Shortlist",
        favorite: true,
        rating: 4,
        tags: ["hook", "warm-light"],
        notes: "Keep framing; reduce the specular highlight.",
        updatedAt: "2026-07-30T09:40:00.000Z",
      },
    },
  };

  const emitMedia = (event: MediaEvent): void => {
    for (const callback of mediaCallbacks) callback(event);
  };
  const openResult = (): LibraryOpenResult => ({
    identity: { storeId: "mock-store", label: "ralphy-project" },
    catalog: mockCatalog(),
  });

  return {
    async chooseLibrary() {
      const result = openResult();
      emitMedia({ type: "root-ready", identity: { storeId: "mock-store", label: "ralphy-project" } });
      emitMedia({ type: "catalog-result", result: result.catalog });
      return result;
    },
    async restoreLibrary() {
      emitMedia({ type: "root-ready", identity: { storeId: "mock-store", label: "ralphy-project" } });
      return openResult();
    },
    async scanProject(
      project: ProjectReference,
      _options?: ProjectScanQuery,
    ): Promise<ProjectScanResult> {
      const result: ProjectScanResult = {
        rootPath: MOCK_ROOT,
        ...project,
        generation: 1,
        items: project.projectId === "coffee-grinder-001" ? mockItems : [],
        ledger: {
          entries: mockItems.flatMap((item) => item.generation ? [item.generation] : []),
          totalCostUsd: 3.84,
          malformedLineCount: 0,
          oversizedLineCount: 0,
          truncated: false,
        },
        completedAt: "2026-07-30T09:43:00.000Z",
      };
      emitMedia({ type: "project-result", result });
      return result;
    },
    async cancelProjectScan() {},
    onMediaEvent(callback) {
      mediaCallbacks.add(callback);
      return () => mediaCallbacks.delete(callback);
    },
    async loadAnnotations() {
      return annotations;
    },
    async updateAnnotations(updates: Record<string, AnnotationInput>) {
      const updatedAt = new Date().toISOString();
      annotations = {
        ...annotations,
        items: {
          ...annotations.items,
          ...Object.fromEntries(
            Object.entries(updates).map(([id, value]) => [id, { ...value, updatedAt }]),
          ),
        },
      };
      return annotations;
    },
    async trashItems(paths) {
      return { trashed: paths, failed: [] };
    },
    async showInFinder() {},
    async openExternal() {
      return "";
    },
    startFileDrag() {},
    async copyText() {},
    async copyMigrationRecoveryCommand() {},
    async readText(path, maxBytes = 256 * 1024) {
      const text = path.endsWith("BRIEF.md")
        ? "# Arc Grinder Launch\n\nA tactile 15-second creator review."
        : "{\n  \"phase\": \"production\"\n}";
      return {
        text: text.slice(0, maxBytes),
        totalBytes: text.length,
        truncated: text.length > maxBytes,
      };
    },
    async getMediaUrl(path) {
      if (/\.(png|jpe?g|webp)$/i.test(path)) {
        return {
          url: "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=1200&q=85",
          sizeBytes: 1024,
        };
      }
      return { url: path, sizeBytes: 1024 };
    },
    async createTerminal(dimensions: TerminalDimensions): Promise<TerminalSession> {
      const session: TerminalSession = {
        id: `mock-terminal-${Date.now()}`,
        label: "ralphy-project",
        shell: "/bin/zsh",
        pid: 4242,
        status: "running",
      };
      queueMicrotask(() => {
        for (const callback of terminalCallbacks) {
          callback({
            type: "data",
            sessionId: session.id,
            data: `\u001b[36m${MOCK_ROOT}\u001b[0m\n❯ `,
          });
        }
      });
      void dimensions;
      return session;
    },
    writeTerminal(sessionId, data) {
      for (const callback of terminalCallbacks) {
        callback({ type: "data", sessionId, data });
      }
    },
    resizeTerminal() {},
    async killTerminal(sessionId) {
      for (const callback of terminalCallbacks) {
        callback({ type: "exit", sessionId, exitCode: 0, signal: 0 });
      }
    },
    onTerminalEvent(callback) {
      terminalCallbacks.add(callback);
      return () => terminalCallbacks.delete(callback);
    },
    async getAgentProviders() {
      return [
        {
          id: "claude" as const,
          label: "Claude",
          binaryReady: true,
          accountConnected: claudeAuth.subscriptionLoggedIn,
          apiKeyConfigured: claudeAuth.apiKeyConfigured,
          inheritedApiKey: false,
          connected: claudeAuth.subscriptionLoggedIn || claudeAuth.apiKeyConfigured,
          detail: "Claude account",
          models: [
            { id: "opus", label: "Claude Opus", description: "Highest capability" },
            { id: "sonnet", label: "Claude Sonnet", description: "Balanced" },
            { id: "fable", label: "Claude Fable", description: "Fast" },
          ],
          defaultModel: "sonnet",
        },
        {
          id: "codex" as const,
          label: "Codex",
          binaryReady: true,
          accountConnected: true,
          apiKeyConfigured: false,
          inheritedApiKey: false,
          connected: true,
          detail: "Logged in using ChatGPT",
          models: [
            { id: "gpt-5.5", label: "GPT-5.5", description: "Codex" },
            { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Codex" },
          ],
          defaultModel: "gpt-5.5",
        },
        {
          id: "openrouter" as const,
          label: "OpenRouter",
          binaryReady: true,
          accountConnected: false,
          apiKeyConfigured: openRouterConfigured,
          inheritedApiKey: false,
          connected: openRouterConfigured,
          detail: openRouterConfigured ? "API key ready" : "API key required",
          models: [
            { id: "openai/gpt-5.5", label: "OpenAI: GPT-5.5", description: "400K context" },
            { id: "google/gemini-3-pro", label: "Google: Gemini 3 Pro", description: "Tools" },
          ],
          defaultModel: "openai/gpt-5.5",
        },
      ];
    },
    async loginAgentProvider(provider) {
      if (provider === "claude") claudeAuth = { ...claudeAuth, subscriptionLoggedIn: true };
      return this.getAgentProviders();
    },
    async setAgentApiKey(provider) {
      if (provider === "claude") claudeAuth = { ...claudeAuth, apiKeyConfigured: true };
      if (provider === "openrouter") openRouterConfigured = true;
      return this.getAgentProviders();
    },
    async clearAgentApiKey(provider) {
      if (provider === "claude") claudeAuth = { ...claudeAuth, apiKeyConfigured: false };
      if (provider === "openrouter") openRouterConfigured = false;
      return this.getAgentProviders();
    },
    async sendAgentMessage(request: AgentChatRequest) {
      const emitAgent = (event: AgentChatEnvelope["event"]): void => {
        const envelope: AgentChatEnvelope = {
          storeId: "mock-store",
          chatId: request.chatId,
          provider: request.provider,
          event,
        };
        for (const callback of agentCallbacks) callback(envelope);
      };
      const sessionId = "0199a213-81c0-7800-8aa1-bbab2a035a53";
      emitAgent({ type: "session", sessionId, tools: ["Read", "Bash"] });
      emitAgent({ type: "text-delta", text: "I’ll inspect the active Ralphy project." });
      emitAgent({ type: "tool-start", id: "mock-tool", name: "Read", summary: "BRIEF.md" });
      emitAgent({ type: "tool-result", id: "mock-tool", ok: true });
      emitAgent({ type: "text-delta", text: " The latest assets are ready for review." });
      emitAgent({
        type: "result",
        ok: true,
        cancelled: false,
        costUsd: 0,
        durationMs: 250,
        sessionId,
      });
    },
    async stopAgent() {},
    onAgentEvent(callback) {
      agentCallbacks.add(callback);
      return () => agentCallbacks.delete(callback);
    },
    onToggleRightPanel() {
      return () => {};
    },
  };
}

const injectedBridge = typeof window === "undefined" ? undefined : window.ralphy;
const rendererEnvironment = (import.meta as ImportMeta & {
  env: Record<string, string | boolean | undefined>;
}).env;
export function mockBridgeAllowed(
  environment: Record<string, string | boolean | undefined>,
): boolean {
  return environment.MODE === "test"
    || environment.VITE_RALPHY_ENABLE_MOCKS === "true";
}
const mockBridgeEnabled = mockBridgeAllowed(rendererEnvironment);
if (!injectedBridge && !mockBridgeEnabled) {
  throw new Error("Ralphy Desktop IPC bridge is unavailable");
}
export const bridge: RalphyBridge = injectedBridge ?? createMockBridge();
