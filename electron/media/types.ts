export type ReviewStatus =
  | "Unreviewed"
  | "Approved"
  | "Shortlist"
  | "Needs Work"
  | "Reject";

export type MediaEntity =
  | "final-render"
  | "generated-artifact"
  | "reference"
  | "unit-asset"
  | "lifecycle-document"
  | "production-file"
  | "other-project-file";

export type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "pdf"
  | "other";

export interface ProjectReference {
  workspaceId: string;
  projectId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  absolutePath: string;
  projectCount: number;
  sharedCount: number;
  unitCount: number;
  finalCount: number;
  recentActivity: string;
}

export interface ProjectSummary extends ProjectReference {
  id: string;
  name: string;
  brief: string;
  absolutePath: string;
  status: string;
  phase: string | null;
  finalState: string;
  platform: string | null;
  aspectRatio: string | null;
  spendUsd: number | null;
  finalCount: number;
  sharedCount: number;
  unitCount: number;
  recentActivity: string;
}

export interface GenerationAttribution {
  provider: string;
  model: string;
  operation: string;
  timestamp: string;
  costUsd: number | null;
  slot: string | null;
}

export interface MediaItem extends ProjectReference {
  id: string;
  name: string;
  absolutePath: string;
  projectRelativePath: string;
  entity: MediaEntity;
  kind: MediaKind;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  generation: GenerationAttribution | null;
}

export interface MediaPreviewSource {
  url: string;
  sizeBytes: number;
}

export const MAX_WAVEFORM_DECODE_BYTES = 24 * 1024 * 1024;

export interface MediaAnnotation {
  reviewStatus: ReviewStatus;
  favorite: boolean;
  rating: number;
  tags: string[];
  notes: string;
  updatedAt: string;
}

export interface AnnotationInput {
  reviewStatus: ReviewStatus;
  favorite: boolean;
  rating: number;
  tags: string[];
  notes: string;
}

export interface AnnotationStore {
  version: number;
  items: Record<string, MediaAnnotation>;
}

export type ProjectMode = "overview" | "finals" | "assets" | "refs" | "units" | "files";
export type MediaSort = "recent" | "name" | "size" | "cost" | "review";
export type MediaGroup = "none" | "entity" | "kind" | "review";

export interface MediaQueryOptions {
  mode: ProjectMode;
  search: string;
  entities: MediaEntity[];
  kinds: MediaKind[];
  reviewStatuses: ReviewStatus[];
  sortBy: MediaSort;
  sortDirection: "ascending" | "descending";
  groupBy: MediaGroup;
  includeIntermediate: boolean;
}

export interface ProjectScanQuery {
  includeIntermediate?: boolean;
}

export interface CatalogProgress {
  generation: number;
  workspacesRead: number;
  projectsRead: number;
}

export interface ProjectScanProgress extends ProjectReference {
  generation: number;
  filesScanned: number;
  bytesScanned: number;
}

export interface CatalogResult {
  rootPath: string;
  generation: number;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  mediaItemCount: 0;
  completedAt: string;
}

export interface GenerationLedgerResult {
  entries: GenerationAttribution[];
  totalCostUsd: number;
  malformedLineCount: number;
  oversizedLineCount: number;
  truncated: boolean;
}

export interface ProjectScanResult extends ProjectReference {
  rootPath: string;
  generation: number;
  items: MediaItem[];
  ledger: GenerationLedgerResult;
  completedAt: string;
}

export interface ProjectScanRequest extends ProjectReference {
  rootPath: string;
  generation: number;
  includeIntermediate?: boolean;
}

export interface LibraryOpenResult {
  identity: RootIdentity;
  catalog: CatalogResult;
}

export interface RootIdentity {
  storeId: string;
  label: string;
}

export interface MigrationRecovery {
  runId: string;
  phase: string;
}

export interface TextReadResult {
  text: string;
  totalBytes: number;
  truncated: boolean;
}

export interface TrashResult {
  trashed: string[];
  failed: Array<{ path: string; error: string }>;
}

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface TerminalSession {
  id: string;
  label: string;
  shell: string;
  pid: number;
  status: "running" | "exited";
  exitCode?: number;
  signal?: number;
}

export type TerminalEvent =
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number; signal: number };

export type AgentProvider = "claude" | "codex" | "openrouter";
export type AgentPermissionMode = "auto" | "plan" | "full";
export type ClaudeAuthMethod = "subscription" | "api-key";
export type ClaudePermissionMode = AgentPermissionMode;

export interface ClaudeAuthState {
  binaryReady: boolean;
  subscriptionLoggedIn: boolean;
  subscriptionAuthMethod: string | null;
  apiKeyConfigured: boolean;
  inheritedApiKey: boolean;
}

export type AgentChatEvent =
  | { type: "session"; sessionId: string; tools: string[] }
  | { type: "text-delta"; text: string }
  | { type: "tool-start"; id: string; name: string; summary: string }
  | { type: "tool-result"; id: string; ok: boolean }
  | {
    type: "result";
    ok: boolean;
    cancelled: boolean;
    costUsd: number;
    durationMs: number;
    sessionId: string | null;
  }
  | { type: "error"; code: string; message: string };

export type ClaudeChatEvent = AgentChatEvent;

export interface AgentChatRequest {
  chatId: string;
  provider: AgentProvider;
  model: string;
  prompt: string;
  project?: ProjectReference | null;
  claudeAuthMethod: ClaudeAuthMethod;
  permissionMode: AgentPermissionMode;
  resumeSessionId?: string | null;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description: string;
}

export interface AgentProviderStatus {
  id: AgentProvider;
  label: string;
  binaryReady: boolean;
  accountConnected: boolean;
  apiKeyConfigured: boolean;
  inheritedApiKey: boolean;
  connected: boolean;
  detail: string;
  models: AgentModelOption[];
  defaultModel: string;
}

export interface AgentChatEnvelope {
  storeId: string;
  chatId: string;
  provider: AgentProvider;
  event: AgentChatEvent;
}

export type MediaEvent =
  | { type: "root-ready"; identity: RootIdentity }
  | { type: "migration-recovery"; recovery: MigrationRecovery }
  | { type: "catalog-progress"; progress: CatalogProgress }
  | { type: "catalog-result"; result: CatalogResult }
  | { type: "project-progress"; progress: ProjectScanProgress }
  | { type: "project-result"; result: ProjectScanResult }
  | { type: "project-cancelled"; request: ProjectScanRequest }
  | { type: "error"; operation: string; message: string; generation?: number };

export interface MediaWorkbenchBridge {
  chooseLibrary(): Promise<LibraryOpenResult | null>;
  restoreLibrary(): Promise<LibraryOpenResult | null>;
  scanProject(
    project: ProjectReference,
    options?: ProjectScanQuery,
  ): Promise<ProjectScanResult>;
  cancelProjectScan(): Promise<void>;
  onMediaEvent(callback: (event: MediaEvent) => void): () => void;
  loadAnnotations(): Promise<AnnotationStore>;
  updateAnnotations(updates: Record<string, AnnotationInput>): Promise<AnnotationStore>;
  trashItems(paths: string[]): Promise<TrashResult>;
  showInFinder(path: string): Promise<void>;
  openExternal(path: string): Promise<string>;
  startFileDrag(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  copyMigrationRecoveryCommand(): Promise<void>;
  readText(path: string, maxBytes?: number): Promise<TextReadResult>;
  getMediaUrl(path: string): Promise<MediaPreviewSource>;
  createTerminal(dimensions: TerminalDimensions): Promise<TerminalSession>;
  writeTerminal(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, dimensions: TerminalDimensions): Promise<void>;
  killTerminal(sessionId: string): Promise<void>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  getAgentProviders(): Promise<AgentProviderStatus[]>;
  loginAgentProvider(provider: "claude" | "codex"): Promise<AgentProviderStatus[]>;
  setAgentApiKey(
    provider: "claude" | "openrouter",
    apiKey: string,
  ): Promise<AgentProviderStatus[]>;
  clearAgentApiKey(provider: "claude" | "openrouter"): Promise<AgentProviderStatus[]>;
  sendAgentMessage(request: AgentChatRequest): Promise<void>;
  stopAgent(): Promise<void>;
  onAgentEvent(callback: (event: AgentChatEnvelope) => void): () => void;
  onToggleRightPanel(callback: () => void): () => void;
}

export const APP_CHANNELS = {
  toggleRightPanel: "app:toggle-right-panel",
} as const;

export const MEDIA_CHANNELS = {
  chooseLibrary: "media:library:choose",
  restoreLibrary: "media:library:restore",
  scanProject: "media:project:scan",
  cancelProjectScan: "media:project:cancel",
  event: "media:event",
  loadAnnotations: "media:annotations:load",
  updateAnnotations: "media:annotations:update",
  trashItems: "media:files:trash",
  showInFinder: "media:files:finder",
  openExternal: "media:files:open",
  startFileDrag: "media:files:drag",
  copyText: "media:clipboard:write",
  copyMigrationRecoveryCommand: "media:migration:recovery-command",
  readText: "media:text:read",
  getMediaUrl: "media:url",
} as const;

export const TERMINAL_CHANNELS = {
  create: "terminal:create",
  write: "terminal:write",
  resize: "terminal:resize",
  kill: "terminal:kill",
  event: "terminal:event",
} as const;

export const AGENT_CHANNELS = {
  providers: "agent:providers",
  login: "agent:login",
  setApiKey: "agent:api-key:set",
  clearApiKey: "agent:api-key:clear",
  send: "agent:send",
  stop: "agent:stop",
  event: "agent:event",
} as const;

export type WorkerRequest =
  | { type: "catalog"; requestId: number; rootPath: string; generation: number }
  | { type: "scan-project"; requestId: number; request: ProjectScanRequest }
  | { type: "cancel-project" };

export type WorkerResponse =
  | { type: "catalog-progress"; requestId: number; progress: CatalogProgress }
  | { type: "catalog-result"; requestId: number; result: CatalogResult }
  | { type: "project-progress"; requestId: number; progress: ProjectScanProgress }
  | { type: "project-result"; requestId: number; result: ProjectScanResult }
  | { type: "project-cancelled"; requestId: number }
  | { type: "error"; requestId: number; message: string };
