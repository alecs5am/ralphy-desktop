export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const BRIDGE_CONTRACT_VERSION = 1 as const;
export const BRIDGE_LIMITS = {
  maxFrameBytes: 1_048_576,
  maxRequestIdBytes: 128,
  maxInFlight: 64,
  maxSeenIds: 65_536,
  maxOutboundBytes: 8_388_608,
  maxAgentDeltaBytes: 65_536,
} as const;

export const BRIDGE_METHODS = [
  "system.hello",
  "consumer.authenticate",
  "consumer.session.start",
  "consumer.session.end",
  "session.start",
  "session.show",
  "session.list",
  "session.end",
  "workspace.list",
  "workspace.show",
  "workspace.update",
  "workspace.overview",
  "workspace.account.list",
  "workspace.account.upsert",
  "workspace.export",
  "workspace.import",
  "project.list",
  "project.show",
  "project.update",
  "project.status",
  "project.overview",
  "project.iteration.list",
  "project.iteration.create",
  "feedback.list",
  "feedback.add",
  "feedback.resolve",
  "document.create",
  "document.list",
  "document.show",
  "document.revisions",
  "document.content",
  "document.search",
  "document.revise",
  "document.bind",
  "media.list",
  "media.show",
  "media.revisions",
  "media.select",
  "media.review",
  "evaluation.list",
  "evaluation.show",
  "evaluation.create",
  "run.list",
  "run.show",
  "run.objects",
  "run.results",
  "run.cancel",
  "operation.find",
  "generation.start",
  "transform.start",
  "transcription.start",
  "repair.start",
  "composition.list",
  "composition.show",
  "composition.revise",
  "composition.build",
  "composition.select",
  "unit.list",
  "unit.show",
  "unit.revise",
  "unit.select",
  "unit.preview",
  "publication.list",
  "publication.publish",
  "publication.lookup",
  "publication.cancel",
  "publication.reconcile",
  "publication.recover",
  "publication.refresh",
  "metric.list",
  "metric.totals",
  "campaign.list",
  "campaign.show",
  "campaign.update",
  "calendar.list",
  "calendar.update",
  "activity.list",
  "activity.subscribe",
  "activity.unsubscribe",
  "locator.resolve",
  "agent.providers",
  "agent.credential.status",
  "agent.credential.set",
  "agent.credential.clear",
  "agent.auth.status",
  "agent.auth.login",
  "agent.turn.start",
  "agent.turn.resume",
  "agent.turn.status",
  "agent.turn.stop",
  "migration.secret.import",
  "migration.desktop.import",
  "migration.consumer.map",
] as const;

export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export type BridgeRequest = {
  v: 1;
  id: string;
  method: string;
  params?: unknown;
};

export type BridgeSuccess = {
  v: 1;
  id: string;
  ok: true;
  result: unknown;
};

export interface BridgeErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type BridgeFailure = {
  v: 1;
  id: string | null;
  ok: false;
  error: BridgeErrorPayload;
};

export interface ActivityDto {
  sequence: number;
  workspaceId: string | null;
  projectId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: number;
}

export type BridgeEvent =
  | {
    v: 1;
    event: "activity";
    subscriptionId: string;
    sequence: number;
    data: ActivityDto;
  }
  | {
    v: 1;
    event: "agent";
    agentSessionId: string;
    turnId: string;
    sequence: number;
    data: unknown;
  };

export type FarmConsumerHello = null | {
  namespace: "farm";
  state: "pending" | "ready";
  coreMigrationRunId: string;
  migrationId: string;
  stageDigest: string;
  readyRecordDigest: string;
  identityDigest: string | null;
};

export interface BridgeHello {
  protocolVersion: 1;
  contractVersion: 1;
  schemaVersion: number;
  coreVersion: string;
  storeId: string;
  rootId: string;
  consumerNamespaces: ["farm"];
  consumers: { farm: FarmConsumerHello };
  methods: BridgeMethod[];
  activitySequence: number;
  limits: typeof BRIDGE_LIMITS;
}

export type BridgeContext =
  | { sessionId: string; workspaceId?: never; projectId?: never }
  | { sessionId?: never; workspaceId: string; projectId?: string };

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export interface Page<Item, Cursor = string> { items: Item[]; nextCursor: Cursor | null }
export interface AckDto { ok: true }

interface EntityDto { id: string }
interface ScopedDto extends EntityDto { workspaceId: string; projectId: string | null }
interface RevisionDto extends EntityDto { revisionNo: number; createdAt: number }

export interface WorkspaceDto extends EntityDto {
  slug: string;
  name: string;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
}
export interface SocialAccountDto extends EntityDto {
  workspaceId: string;
  platform: string;
  provider: string;
  handle: string | null;
  relinkRequired: boolean;
}
export interface ProjectDto extends EntityDto {
  workspaceId: string;
  slug: string;
  name: string;
  status: string;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
}
export interface SessionDto extends ScopedDto {
  tool: string;
  state: string;
  startedAt: number;
  endedAt: number | null;
}
export interface IterationDto extends EntityDto {
  projectId: string;
  ordinal: number;
  state: string;
  createdAt: number;
}
export interface FeedbackDto extends EntityDto {
  projectId: string;
  iterationId: string;
  text: string;
  state: string;
  createdAt: number;
}
export interface DocumentDto extends ScopedDto {
  slug: string;
  kind: string;
  selectedRevisionId: string | null;
  createdAt: number;
}
export interface DocumentRevisionDto extends RevisionDto {
  documentId: string;
  format: string;
}
export interface DocumentBindingDto {
  ownerType: "project" | "build";
  ownerId: string;
  role: string;
  documentId: string;
  boundRevisionId: string;
  currentHeadRevisionId: string;
  hasNewerHead: boolean;
}
export type MediaRef = {
  type: "artifact" | "run-object" | "object";
  id: string;
};
export interface MediaCardDto extends ScopedDto {
  ref: MediaRef;
  kind: string;
  mime: string | null;
  bytes: number | null;
  createdAt: number;
}
export interface ArtifactRevisionDto extends RevisionDto {
  artifactId: string;
  state: string;
  objectId: string | null;
}
export interface EvaluationDto extends ScopedDto {
  targetType: string;
  targetId: string;
  verdict: string;
  favorite: boolean;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  tags: string[];
  note: string;
  authoredBySessionId: string;
  createdAt: number;
}
export type RunState = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export interface RunDto extends EntityDto {
  workspaceId: string | null;
  projectId: string | null;
  agentSessionId: string | null;
  kind: string;
  label: string | null;
  state: RunState;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}
export interface RunObjectDto extends EntityDto {
  workspaceId: string | null;
  projectId: string | null;
  runId: string;
  purpose: string;
  state: string;
  retention: string;
  mime: string | null;
  bytes: number | null;
  createdAt: number;
  objectId: string | null;
}
export interface RunResultDto extends EntityDto {
  runId: string;
  position: number;
  entityType: string;
  entityId: string;
  createdAt: number;
}
export interface ExternalOperation {
  runId: string;
  nodeId: string;
  attempt: number;
  operation: string;
  idempotencyKey: string;
}
export interface OperationAccepted {
  runId: string;
  state: RunState;
  results: Page<RunResultDto>;
  replayed: boolean;
}
export interface CompositionDto extends ScopedDto {
  slug: string;
  kind: string;
  selectedRevisionId: string | null;
  createdAt: number;
}
export interface CompositionRevisionDto extends RevisionDto {
  compositionId: string;
  state: string;
}
export interface BuildDto extends ScopedDto {
  compositionRevisionId: string;
  runId: string;
  state: string;
  createdAt: number;
}
export interface UnitDto extends ScopedDto {
  slug: string;
  kind: string;
  selectedRevisionId: string | null;
  createdAt: number;
}
export interface UnitRevisionDto extends RevisionDto {
  unitId: string;
  state: string;
}
export interface UnitPreviewDto {
  unitRevisionId: string;
  platform: string;
  presentation: JsonObject;
}
export interface PublicationDto extends ScopedDto {
  unitRevisionId: string;
  platform: string;
  state: string;
  externalId: string | null;
  createdAt: number;
}
export interface PublicationRecoveryResult {
  publication: PublicationDto;
  run: RunDto;
}
export interface MetricDto extends EntityDto {
  publicationId: string;
  capturedAt: number;
  values: JsonObject;
}
export interface CampaignDto extends ScopedDto {
  name: string;
  state: string;
  rowVersion: number;
}
export interface CalendarEntryDto extends ScopedDto {
  publicationId: string | null;
  scheduledAt: number;
  rowVersion: number;
}
export interface AgentProviderDto { id: string; name: string; capabilities: string[] }
export interface CredentialStatusDto { provider: string; state: string; source: string | null }
export interface AgentTurnDto {
  turnId: string;
  runId: string;
  agentSessionId: string;
  state: string;
}
export interface AgentTurnEventDto {
  turnId: string;
  sequence: number;
  kind: string;
  data: JsonValue;
}
export interface WorkspaceOverviewDto { workspace: WorkspaceDto; sections: JsonObject }
export interface ProjectOverviewDto { project: ProjectDto; sections: JsonObject }
export interface LocatorDto { absolutePath: string; mime: string | null; bytes: number }
export interface MigrationDto { runId: string; state: string; issues: number }

export interface MigrationSecretImportParams {
  runId: string;
  sourceEntryId: string;
  ref: string;
  kind: "text";
  value: string;
}

export interface MigrationSecretImportResult {
  ref: string;
  kind: "text";
  completed: true;
}

type EmptyParams = Record<string, never>;
type ScopedParams = { context: BridgeContext };
type CursorParams = { after?: string | null; limit?: number };
type ScopedCursorParams = ScopedParams & CursorParams;
type IdParams<Key extends string> = ScopedParams & { [Field in Key]: string };
type Contract<Params, Result> = { params: Params; result: Result };
type ExternalOperationParams = { external?: ExternalOperation };
type ExternalOperationTuple = Omit<ExternalOperation, "idempotencyKey">;
type OperationFindSelector =
  | { external: ExternalOperationTuple; idempotencyKey?: never }
  | { idempotencyKey: string; external?: never };

export interface MediaReviewParams {
  context: BridgeContext;
  ref: { type: "artifact"; id: string };
  expectedSelectedRevisionId: string;
  verdict: "shortlist" | "approved" | "rejected" | "needs-work";
  favorite?: boolean;
  rating?: 1 | 2 | 3 | 4 | 5 | null;
  tags?: string[];
  notes?: string;
  iterationId?: string;
  feedback?: string;
}

export interface MediaReviewResult {
  card: MediaCardDto & { ref: { type: "artifact"; id: string } };
  revision: ArtifactRevisionDto;
  evaluation: EvaluationDto;
  feedback: FeedbackDto | null;
}

export interface BridgeMethodContract {
  "system.hello": Contract<EmptyParams, BridgeHello>;
  "consumer.authenticate": Contract<{ namespace: "farm"; tokenBase64url: string }, AckDto>;
  "consumer.session.start": Contract<{ workspaceId: string; projectId?: string; tool: string; label?: string }, SessionDto>;
  "consumer.session.end": Contract<{ sessionId: string }, SessionDto>;
  "session.start": Contract<{ workspaceId: string; projectId?: string; tool: string; label?: string }, SessionDto>;
  "session.show": Contract<{ sessionId: string }, SessionDto>;
  "session.list": Contract<ScopedCursorParams, Page<SessionDto>>;
  "session.end": Contract<{ sessionId: string }, SessionDto>;
  "workspace.list": Contract<CursorParams, Page<WorkspaceDto>>;
  "workspace.show": Contract<IdParams<"workspaceId">, WorkspaceDto>;
  "workspace.update": Contract<IdParams<"workspaceId"> & { expectedRowVersion: number; patch: JsonObject }, WorkspaceDto>;
  "workspace.overview": Contract<IdParams<"workspaceId"> & { request: JsonObject }, WorkspaceOverviewDto>;
  "workspace.account.list": Contract<IdParams<"workspaceId"> & CursorParams, Page<SocialAccountDto>>;
  "workspace.account.upsert": Contract<IdParams<"workspaceId"> & { account: JsonObject }, SocialAccountDto>;
  "workspace.export": Contract<IdParams<"workspaceId"> & { idempotencyKey: string }, {
    runId: string;
    packageObjectId: string;
    manifestSummary: { version: number; workspaceId: string; entityCounts: JsonObject };
  }>;
  "workspace.import": Contract<ScopedParams & {
    packageObjectId: string;
    idempotencyKey: string;
    entityAfter?: string | null;
    entityLimit?: number;
    relinkAfter?: string | null;
    relinkLimit?: number;
  }, { workspaceId: string; entityMapPage: Page<JsonObject>; relinkPage: Page<JsonObject> }>;
  "project.list": Contract<IdParams<"workspaceId"> & CursorParams, Page<ProjectDto>>;
  "project.show": Contract<IdParams<"projectId">, ProjectDto>;
  "project.update": Contract<IdParams<"projectId"> & { expectedRowVersion: number; patch: JsonObject }, ProjectDto>;
  "project.status": Contract<IdParams<"projectId">, { projectId: string; status: string; currentIterationId: string | null }>;
  "project.overview": Contract<IdParams<"projectId"> & { request: JsonObject }, ProjectOverviewDto>;
  "project.iteration.list": Contract<IdParams<"projectId"> & CursorParams, Page<IterationDto>>;
  "project.iteration.create": Contract<IdParams<"projectId"> & { label?: string }, IterationDto>;
  "feedback.list": Contract<IdParams<"projectId"> & CursorParams & { state?: string }, Page<FeedbackDto>>;
  "feedback.add": Contract<IdParams<"projectId"> & { iterationId: string; text: string; target?: MediaRef }, FeedbackDto>;
  "feedback.resolve": Contract<IdParams<"feedbackId"> & { resolutionRevisionId: string }, FeedbackDto>;
  "document.create": Contract<ScopedParams & { slug: string; kind: string; format: string; body: string }, DocumentDto>;
  "document.list": Contract<ScopedCursorParams, Page<DocumentDto>>;
  "document.show": Contract<IdParams<"documentId">, DocumentDto>;
  "document.revisions": Contract<IdParams<"documentId"> & CursorParams, Page<DocumentRevisionDto>>;
  "document.content": Contract<ScopedParams & { revisionId: string; afterByte: number; limitBytes: number }, {
    revisionId: string;
    format: string;
    text: string;
    nextByte: number;
  }>;
  "document.search": Contract<ScopedCursorParams & { query: string }, Page<DocumentDto>>;
  "document.revise": Contract<IdParams<"documentId"> & { expectedRevisionId: string; format: string; body: string }, DocumentRevisionDto>;
  "document.bind": Contract<ScopedParams & (
    | { projectId: string; buildId?: never; role: string }
    | { projectId?: never; buildId: string; role: string }
  ) & {
    revisionId: string;
    expectedRevisionId: string | null;
  }, DocumentBindingDto>;
  "media.list": Contract<ScopedCursorParams & { kind?: string }, Page<MediaCardDto>>;
  "media.show": Contract<ScopedParams & { ref: MediaRef }, MediaCardDto>;
  "media.revisions": Contract<ScopedParams & { ref: { type: "artifact"; id: string } } & CursorParams, Page<ArtifactRevisionDto>>;
  "media.select": Contract<ScopedParams & {
    ref: { type: "artifact"; id: string };
    revisionId: string;
    expectedSelectedRevisionId: string;
  }, MediaCardDto>;
  "media.review": Contract<MediaReviewParams, MediaReviewResult>;
  "evaluation.list": Contract<ScopedCursorParams & { target?: { type: string; id: string } }, Page<EvaluationDto>>;
  "evaluation.show": Contract<IdParams<"evaluationId">, EvaluationDto>;
  "evaluation.create": Contract<ScopedParams & {
    target: { type: string; id: string };
    kind: string;
    verdict: string;
    favorite?: boolean;
    rating?: 1 | 2 | 3 | 4 | 5 | null;
    tags?: string[];
    note?: string;
    report?: JsonValue;
  }, EvaluationDto>;
  "run.list": Contract<ScopedCursorParams & { kind?: string; state?: string }, Page<RunDto>>;
  "run.show": Contract<IdParams<"runId">, RunDto>;
  "run.objects": Contract<IdParams<"runId"> & CursorParams, Page<RunObjectDto>>;
  "run.results": Contract<IdParams<"runId"> & CursorParams, Page<RunResultDto>>;
  "run.cancel": Contract<IdParams<"runId"> & { expectedState: string }, RunDto>;
  "operation.find": Contract<ScopedParams & OperationFindSelector & {
    resultsAfter?: string | null;
    resultsLimit?: number;
  }, { run: RunDto; results: Page<RunResultDto>; replayed: true }>;
  "generation.start": Contract<ScopedParams & ExternalOperationParams & { input: JsonObject }, OperationAccepted>;
  "transform.start": Contract<ScopedParams & ExternalOperationParams & { source: MediaRef; input: JsonObject }, OperationAccepted>;
  "transcription.start": Contract<ScopedParams & ExternalOperationParams & { source: MediaRef; input?: JsonObject }, OperationAccepted>;
  "repair.start": Contract<ScopedParams & ExternalOperationParams & { target: MediaRef; input: JsonObject }, OperationAccepted>;
  "composition.list": Contract<ScopedCursorParams, Page<CompositionDto>>;
  "composition.show": Contract<IdParams<"compositionId">, CompositionDto>;
  "composition.revise": Contract<IdParams<"compositionId"> & { expectedLatestRevisionId: string; input: JsonObject }, CompositionRevisionDto>;
  "composition.build": Contract<ScopedParams & ExternalOperationParams & { compositionRevisionId: string; input?: JsonObject }, OperationAccepted>;
  "composition.select": Contract<IdParams<"compositionId"> & { revisionId: string; expectedSelectedRevisionId: string | null }, CompositionDto>;
  "unit.list": Contract<ScopedCursorParams, Page<UnitDto>>;
  "unit.show": Contract<IdParams<"unitId">, UnitDto>;
  "unit.revise": Contract<IdParams<"unitId"> & ExternalOperationParams & { expectedLatestRevisionId: string; input: JsonObject }, UnitRevisionDto | OperationAccepted>;
  "unit.select": Contract<IdParams<"unitId"> & { revisionId: string; expectedSelectedRevisionId: string | null }, UnitDto>;
  "unit.preview": Contract<ScopedParams & { unitRevisionId: string; platform: string }, UnitPreviewDto>;
  "publication.list": Contract<ScopedCursorParams & { unitId?: string; platform?: string; state?: string }, Page<PublicationDto>>;
  "publication.publish": Contract<ScopedParams & ExternalOperationParams & { unitRevisionId: string; platform: string; input?: JsonObject }, OperationAccepted>;
  "publication.lookup": Contract<IdParams<"publicationId"> & ExternalOperationParams, OperationAccepted>;
  "publication.cancel": Contract<IdParams<"publicationId"> & (
    | { expectedState: "draft"; external?: never }
    | { expectedState: "scheduled" | "submitted"; external?: ExternalOperation }
  ), PublicationDto | OperationAccepted>;
  "publication.reconcile": Contract<IdParams<"publicationId"> & ExternalOperationParams, OperationAccepted>;
  "publication.recover": Contract<IdParams<"publicationId"> & {
    expectedState: string;
    expectedClaimKind: "status-lookup" | "cancellation" | "reconciliation";
    expectedClaimRunId: string;
    expectedClaimEpoch: number;
  }, PublicationRecoveryResult>;
  "publication.refresh": Contract<IdParams<"publicationId"> & ExternalOperationParams, OperationAccepted>;
  "metric.list": Contract<IdParams<"publicationId"> & CursorParams, Page<MetricDto>>;
  "metric.totals": Contract<IdParams<"publicationId">, { publicationId: string; values: JsonObject }>;
  "campaign.list": Contract<ScopedCursorParams, Page<CampaignDto>>;
  "campaign.show": Contract<IdParams<"campaignId">, CampaignDto>;
  "campaign.update": Contract<IdParams<"campaignId"> & { expectedRowVersion: number; patch: JsonObject }, CampaignDto>;
  "calendar.list": Contract<ScopedCursorParams & { from?: number; to?: number }, Page<CalendarEntryDto>>;
  "calendar.update": Contract<IdParams<"calendarEntryId"> & { expectedRowVersion: number; patch: JsonObject }, CalendarEntryDto>;
  "activity.list": Contract<{ afterSequence: number; limit: number }, Page<ActivityDto, number>>;
  "activity.subscribe": Contract<{ afterSequence: number }, { subscriptionId: string; afterSequence: number }>;
  "activity.unsubscribe": Contract<{ subscriptionId: string }, AckDto>;
  "locator.resolve": Contract<ScopedParams & {
    target: { type: "object" | "run-object"; id: string };
    purpose: "preview" | "read-text" | "finder" | "open" | "drag";
  }, LocatorDto>;
  "agent.providers": Contract<EmptyParams, AgentProviderDto[]>;
  "agent.credential.status": Contract<ScopedParams & { provider: string }, CredentialStatusDto>;
  "agent.credential.set": Contract<ScopedParams & { provider: string; credential: string }, CredentialStatusDto>;
  "agent.credential.clear": Contract<ScopedParams & { provider: string }, CredentialStatusDto>;
  "agent.auth.status": Contract<ScopedParams & { provider: string }, CredentialStatusDto>;
  "agent.auth.login": Contract<ScopedParams & { provider: string }, CredentialStatusDto>;
  "agent.turn.start": Contract<ScopedParams & {
    provider: string;
    prompt: string;
    chatId?: string;
    external?: ExternalOperation;
    input?: JsonObject;
  }, AgentTurnDto>;
  "agent.turn.resume": Contract<ScopedParams & ExternalOperationParams & { turnId: string; prompt: string; chatId?: string }, AgentTurnDto>;
  "agent.turn.status": Contract<ScopedParams & { turnId: string } & CursorParams, { turn: AgentTurnDto; events: Page<AgentTurnEventDto> }>;
  "agent.turn.stop": Contract<ScopedParams & { turnId: string; expectedState: string }, AgentTurnDto>;
  "migration.secret.import": Contract<MigrationSecretImportParams, MigrationSecretImportResult>;
  "migration.desktop.import": Contract<{ payload: JsonObject; idempotencyKey: string }, MigrationDto>;
  "migration.consumer.map": Contract<{
    migrationRunId: string;
    lockNonce: string;
    namespace: "farm";
    grantDigest: string;
    sourceIdentityId: string;
    sourceInventoryDigest: string;
    afterSourceLocatorHash?: string | null;
    limit: number;
  }, Page<{ sourceLocatorHash: string; sourceKind: string; targetRefs: Array<{ type: string; id: string }> }>>;
}

type AssertNever<Value extends never> = Value;
export type MissingBridgeMethodContracts = AssertNever<Exclude<BridgeMethod, keyof BridgeMethodContract>>;
export type ExtraBridgeMethodContracts = AssertNever<Exclude<keyof BridgeMethodContract, BridgeMethod>>;
export type ParamsFor<Method extends BridgeMethod> = BridgeMethodContract[Method]["params"];
export type ResultFor<Method extends BridgeMethod> = BridgeMethodContract[Method]["result"];
