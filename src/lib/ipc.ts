import type {
  AnnotationInput,
  AnnotationStore,
  CatalogResult,
  GenerationAttribution,
  LibraryOpenResult,
  MediaEntity,
  MediaEvent,
  MediaItem,
  MediaKind,
  MediaWorkbenchBridge,
  ProjectReference,
  ProjectScanResult,
  ProjectSummary,
  WorkspaceSummary,
} from "../../electron/media/types";

export type {
  AnnotationInput,
  AnnotationStore,
  CatalogResult,
  GenerationAttribution,
  LibraryOpenResult,
  MediaAnnotation,
  MediaEntity,
  MediaEvent,
  MediaItem,
  MediaKind,
  MediaQueryOptions,
  MediaWorkbenchBridge,
  ProjectReference,
  ProjectScanProgress,
  ProjectScanResult,
  ProjectSummary,
  ReviewStatus,
  TextReadResult,
  TrashResult,
  WorkspaceSummary,
} from "../../electron/media/types";

export type AuthMethod = "subscription" | "api-key";

export interface AuthState {
  method: AuthMethod | null;
  claudeBinaryReady: boolean;
  apiKeyInEnv: boolean;
}

export type AgentEvent =
  | { type: "system"; sessionId: string; tools: string[] }
  | { type: "assistant-text"; text: string }
  | { type: "tool-use"; id: string; name: string; summary: string; estCostUsd?: number }
  | { type: "tool-result"; id: string; ok: boolean }
  | { type: "result"; ok: boolean; costUsd: number };

export interface PermissionRequest {
  id: string;
  toolName: string;
  command: string;
  estCostUsd?: number;
}

interface LegacyAgentBridge {
  getAuthState(): Promise<AuthState>;
  setAuthMethod(method: AuthMethod): Promise<void>;
  send(prompt: string): Promise<void>;
  onEvent(callback: (event: AgentEvent) => void): () => void;
  onPermission(callback: (request: PermissionRequest) => void): () => void;
  resolvePermission(id: string, allow: boolean): Promise<void>;
}

export interface RalphyBridge extends MediaWorkbenchBridge, LegacyAgentBridge {}

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
    id: "coffee-grinder-001",
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
    id: "skin-set-004",
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
    id: "trail-shoe-002",
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
  const agentCallbacks = new Set<(event: AgentEvent) => void>();
  const permissionCallbacks = new Set<(request: PermissionRequest) => void>();
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
  const emitAgent = (event: AgentEvent): void => {
    for (const callback of agentCallbacks) callback(event);
  };

  const openResult = (): LibraryOpenResult => ({
    rootPath: MOCK_ROOT,
    catalog: mockCatalog(),
  });

  return {
    async chooseLibrary() {
      const result = openResult();
      emitMedia({ type: "catalog-result", result: result.catalog });
      return result;
    },
    async restoreLibrary() {
      return openResult();
    },
    async openLibrary() {
      return openResult();
    },
    async scanProject(project: ProjectReference): Promise<ProjectScanResult> {
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
    async copyText() {},
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
        return "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=1200&q=85";
      }
      return path;
    },

    async getAuthState() {
      return { method: "subscription", claudeBinaryReady: true, apiKeyInEnv: false };
    },
    async setAuthMethod() {},
    async send(prompt: string) {
      emitAgent({ type: "system", sessionId: "mock-session", tools: ["Read", "Bash"] });
      emitAgent({ type: "assistant-text", text: `Reviewing "${prompt}".` });
      emitAgent({ type: "result", ok: true, costUsd: 0 });
    },
    onEvent(callback) {
      agentCallbacks.add(callback);
      return () => agentCallbacks.delete(callback);
    },
    onPermission(callback) {
      permissionCallbacks.add(callback);
      return () => permissionCallbacks.delete(callback);
    },
    async resolvePermission() {},
  };
}

const injectedBridge = typeof window === "undefined" ? undefined : window.ralphy;
export const bridge: RalphyBridge = injectedBridge ?? createMockBridge();
