import type { UIMessage, UIMessageChunk } from "ai";
import { Schema } from "effect";

export const toStandardSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const SessionRefSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  // Server-generated, opaque to clients, and globally unique for reverse lookup.
  // Session operations still use the complete ref rather than this field alone.
  sessionId: Schema.NonEmptyString,
});
export type SessionRef = typeof SessionRefSchema.Type;

/** Absolute workspace directory, or a session whose stored `cwd` the server resolves. */
export const WorkspaceCwdQuerySchema = Schema.Struct({ cwd: Schema.String });
export const WorkspaceRefQuerySchema = Schema.Struct({ ref: SessionRefSchema });
export const WorkspaceQuerySchema = Schema.Union([
  WorkspaceCwdQuerySchema,
  WorkspaceRefQuerySchema,
]);
export type WorkspaceQuery = typeof WorkspaceQuerySchema.Type;

/** Same `{ cwd } | { ref }` arms with extra fields on each object. */
export const withWorkspaceQuery = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Union([
    Schema.Struct({ cwd: Schema.String, ...fields }),
    Schema.Struct({ ref: SessionRefSchema, ...fields }),
  ]);

// ---------------------------------------------------------------------------
// Approval model (agent requests / responses)
// ---------------------------------------------------------------------------

export const AgentGrantSchema = Schema.Struct({ type: Schema.Literal("session") });
export type AgentGrant = typeof AgentGrantSchema.Type;

export const AgentRequestActionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  behavior: Schema.Literals(["allow", "deny"]),
  grant: Schema.optionalKey(AgentGrantSchema),
  variant: Schema.optionalKey(Schema.Literals(["primary", "secondary", "danger"])),
});
export type AgentRequestAction = typeof AgentRequestActionSchema.Type;

export const AgentRequestQuestionSchema = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  header: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals(["choice", "freeText"])),
  options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        label: Schema.String,
        description: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  multiSelect: Schema.optionalKey(Schema.Boolean),
});
export type AgentRequestQuestion = typeof AgentRequestQuestionSchema.Type;

export const AgentRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    id: Schema.String,
    toolName: Schema.String,
    input: Schema.Record(Schema.String, Schema.Unknown),
    actions: Schema.Array(AgentRequestActionSchema),
    title: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    native: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("question"),
    id: Schema.String,
    questions: Schema.Array(AgentRequestQuestionSchema),
    native: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("plan"),
    id: Schema.String,
    plan: Schema.String,
    native: Schema.Unknown,
  }),
]);
export type AgentRequest = typeof AgentRequestSchema.Type;

export const AgentResponseAnswerSchema = Schema.Struct({
  questionId: Schema.String,
  values: Schema.Array(Schema.String),
  other: Schema.optionalKey(Schema.String),
});
export type AgentResponseAnswer = typeof AgentResponseAnswerSchema.Type;

export const PlanApprovalModeSchema = Schema.Literals([
  "default",
  "acceptEdits",
  "bypassPermissions",
]);
export type PlanApprovalMode = typeof PlanApprovalModeSchema.Type;

export const AgentResponseSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    selectedActionId: Schema.optionalKey(Schema.String),
    behavior: Schema.Literals(["allow", "deny"]),
    grant: Schema.optionalKey(AgentGrantSchema),
    message: Schema.optionalKey(Schema.String),
    interrupt: Schema.optionalKey(Schema.Boolean),
    native: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal("question"),
    answers: Schema.Array(AgentResponseAnswerSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("plan"),
    behavior: Schema.Literals(["allow", "deny"]),
    mode: Schema.optionalKey(PlanApprovalModeSchema),
    message: Schema.optionalKey(Schema.String),
    interrupt: Schema.optionalKey(Schema.Boolean),
    native: Schema.optionalKey(Schema.Unknown),
  }),
]);
export type AgentResponse = typeof AgentResponseSchema.Type;

// ---------------------------------------------------------------------------
// Turn outcome
// ---------------------------------------------------------------------------

export const TokenUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.optionalKey(Schema.Number),
  cacheCreationTokens: Schema.optionalKey(Schema.Number),
});
export type TokenUsage = typeof TokenUsageSchema.Type;

export const TurnErrorCategorySchema = Schema.Literals([
  "auth_expired",
  "rate_limited",
  "context_overflow",
  "model_unavailable",
  "network",
  "cancelled",
  "unknown",
]);
export type TurnErrorCategory = typeof TurnErrorCategorySchema.Type;

export const TurnErrorSchema = Schema.Struct({
  message: Schema.String,
  category: TurnErrorCategorySchema,
  retryAfterMs: Schema.optionalKey(Schema.Number),
});
export type TurnError = typeof TurnErrorSchema.Type;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const SessionPhaseSchema = Schema.Literals([
  "idle",
  "running",
  "requires_action",
  "crashed",
]);
export type SessionPhase = typeof SessionPhaseSchema.Type;

export const SessionStatusSchema = Schema.Struct({
  phase: SessionPhaseSchema,
  activeTurnId: Schema.optionalKey(Schema.String),
});
export type SessionStatus = typeof SessionStatusSchema.Type;

// ---------------------------------------------------------------------------
// Events
//
// Session-scoped events carry `seq`: contiguous per session, stamped by the
// server's `HarnessAgentSession`, starting at 1. Collection events are
// unnumbered — they are invalidation signals recovered via list methods, never
// replayed. Events are TypeScript types, not Schemas: they are produced by the
// server and never validated as RPC input.
// ---------------------------------------------------------------------------

export const SessionScopedEventTypes = [
  "session.message.chunk",
  "session.prompt.submitted",
  "session.prompt.rejected",
  "session.turn.started",
  "session.turn.ended",
  "session.request.asked",
  "session.request.replied",
  "session.request.rejected",
  "session.crashed",
] as const;
export type SessionScopedEventType = (typeof SessionScopedEventTypes)[number];

export const CollectionEventTypes = [
  "session.created",
  "session.updated",
  "session.archived",
  "session.deleted",
  "session.renamed",
  "session.closed",
] as const;
export type CollectionEventType = (typeof CollectionEventTypes)[number];

export type SessionScopedEventBody =
  | {
      readonly type: "session.message.chunk";
      readonly turnId: string;
      readonly chunk: UIMessageChunk;
    }
  // A user prompt was accepted for this session. Published by the session
  // service *before* the harness call, so it always precedes the turn's own
  // events in seq order; `messageId` echoes the client-supplied id (or a
  // server-minted one), letting the prompting client dedupe its optimistic
  // message while every other client appends it. If the harness then rejects
  // the prompt, `session.prompt.rejected` compensates.
  | {
      readonly type: "session.prompt.submitted";
      readonly messageId: string;
      readonly parts: ReadonlyArray<PromptPart>;
    }
  // Compensates a `session.prompt.submitted` whose harness call was then
  // rejected (turn already running, session closed, harness error): clients
  // drop the message with this id, and the runtime clears the retained
  // activePrompt so a mid-turn joiner never hydrates a prompt that never ran.
  | {
      readonly type: "session.prompt.rejected";
      readonly messageId: string;
      readonly reason?: string;
    }
  | { readonly type: "session.turn.started"; readonly turnId: string }
  | {
      readonly type: "session.turn.ended";
      readonly turnId: string;
      readonly outcome: "completed" | "failed" | "canceled";
      readonly usage?: TokenUsage;
      readonly error?: TurnError;
    }
  | { readonly type: "session.request.asked"; readonly request: AgentRequest }
  | { readonly type: "session.request.replied"; readonly requestId: string }
  | {
      readonly type: "session.request.rejected";
      readonly requestId: string;
      readonly reason?: string;
    }
  | { readonly type: "session.crashed"; readonly reason: string };

/** A session-scoped event before the server's `HarnessAgentSession` stamps its `seq`. */
export type SessionScopedEventDraft = { readonly ref: SessionRef } & SessionScopedEventBody;

export type SessionScopedEvent = {
  readonly seq: number;
  /**
   * The session's phase *after* this event applied, stamped by the server's
   * `HarnessAgentSession` alongside `seq`. Consumers copy it (sidebar status,
   * chat composer state) instead of re-deriving phase from event types — the
   * server-side fold is the only place that knows the full transition table
   * (`requires_action` in particular is invisible to a client-side mapping).
   * Absent only on chunk events replayed from a snapshot's retained buffer;
   * there the snapshot's own `status` is the phase source.
   */
  readonly phase?: SessionPhase;
} & SessionScopedEventDraft;

export type CollectionEvent = { readonly ref: SessionRef } & (
  | { readonly type: "session.created" }
  // Self-owned display data changed on the server (title from the first prompt).
  | { readonly type: "session.updated"; readonly title?: string }
  | { readonly type: "session.archived"; readonly archived: boolean }
  | { readonly type: "session.deleted" }
  | { readonly type: "session.renamed"; readonly title: string }
  // Runtime torn down; list rows drop `status` (no live session in memory).
  | { readonly type: "session.closed" }
);

export type ServerEvent = SessionScopedEvent | CollectionEvent;

export type SessionMessageChunkEvent = Extract<
  SessionScopedEvent,
  { type: "session.message.chunk" }
>;

const collectionEventTypes = new Set<string>(CollectionEventTypes);

export const isSessionScopedEvent = (event: ServerEvent): event is SessionScopedEvent =>
  !collectionEventTypes.has(event.type);

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export const SubscriptionScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("session"), ref: SessionRefSchema }),
  // Firehose: every event of every session plus collection events.
  Schema.Struct({ kind: Schema.Literal("global") }),
]);
export type SubscriptionScope = typeof SubscriptionScopeSchema.Type;

export const SubscribeInputSchema = Schema.Struct({ scope: SubscriptionScopeSchema });
export type SubscribeInput = typeof SubscribeInputSchema.Type;

export const SubscriptionClosedReasonSchema = Schema.Literals([
  "session_closed",
  "session_deleted",
  "stream_replaced",
  "slow_consumer",
  "server_shutdown",
  "internal_error",
]);
export type SubscriptionClosedReason = typeof SubscriptionClosedReasonSchema.Type;

export type SubscribeStreamEvent =
  | { readonly type: "event"; readonly event: ServerEvent }
  | { readonly type: "closed"; readonly reason: SubscriptionClosedReason };

/**
 * Client-side reducer position; never sent on the wire. Only meaningful while
 * the renderer still holds the reducer state merged up to `lastAppliedSeq` of
 * `turnId` — recovery re-reads `getSnapshot` and replays `activeTurn.chunks`
 * with `seq > lastAppliedSeq`.
 */
export type StreamingCursor = {
  readonly turnId: string;
  readonly lastAppliedSeq: number;
};

// ---------------------------------------------------------------------------
// Runtime snapshot
// ---------------------------------------------------------------------------

export type ActiveTurnSnapshot = {
  readonly turnId: string;
  // null until the turn's first `start` chunk announces the message id.
  readonly messageId: string | null;
  readonly chunks: ReadonlyArray<SessionMessageChunkEvent>;
  // A finished turn's buffer is retained (complete: true) until the next turn
  // starts, so recovery can replay a tail that ended mid-disconnect.
  readonly complete: boolean;
  // The buffer is bounded; a turn that overflowed it had its oldest chunks
  // dropped. A truncated buffer cannot rebuild the turn's message from its
  // start — consumers skip it and recover the turn from the history read
  // once it ends.
  readonly truncated: boolean;
};

// The latest accepted prompt, retained like the active turn's buffer:
// `session.prompt.submitted` is never re-sent, so a client attaching mid-turn
// recovers the user message from here. `seq` is the submit event's seq — replay
// gates on it, so a client that saw the live event never renders it twice.
export type ActivePromptSnapshot = {
  readonly messageId: string;
  readonly parts: ReadonlyArray<PromptPart>;
  readonly seq: number;
};

// ---------------------------------------------------------------------------
// Runtime snapshot
// ---------------------------------------------------------------------------

export type SessionRuntimeSnapshot = {
  readonly ref: SessionRef;
  readonly status: SessionStatus;
  readonly pendingRequests: ReadonlyArray<AgentRequest>;
  readonly activeTurn: ActiveTurnSnapshot | null;
  readonly activePrompt: ActivePromptSnapshot | null;
  // Last session-scoped seq folded into this snapshot; 0 before any event.
  readonly cursor: number;
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type SessionMessages = {
  readonly messages: ReadonlyArray<UIMessage>;
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const InspectorTargetSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
});
export type InspectorTarget = typeof InspectorTargetSchema.Type;

export const PromptPartSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.NonEmptyString }),
  // Reserved wire shape: servers reject file parts with UNSUPPORTED until an
  // agent capability lands. Never silently dropped.
  Schema.Struct({
    type: Schema.Literal("file"),
    mediaType: Schema.String,
    url: Schema.String,
    filename: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("data-inspector"),
    data: Schema.Array(InspectorTargetSchema),
  }),
]);
export type PromptPart = typeof PromptPartSchema.Type;

/** When present on `session.create`, create a git worktree before persist (branch name is server-assigned). */
export const CreateWorktreeInputSchema = Schema.Struct({
  /** Local or remote-tracking ref to branch from. Defaults to HEAD when omitted. */
  base: Schema.optionalKey(Schema.NonEmptyString),
});
export type CreateWorktreeInput = typeof CreateWorktreeInputSchema.Type;

export const PromptInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  parts: Schema.Array(PromptPartSchema).check(Schema.isNonEmpty()),
  // The client's own id for the optimistic user message, echoed back in
  // `session.prompt.submitted` so the sender can recognise (and skip) its own
  // prompt while other clients render it. Absent → the server mints one.
  messageId: Schema.optionalKey(Schema.NonEmptyString),
});
export type PromptInput = typeof PromptInputSchema.Type;

export const PromptOutputSchema = Schema.Struct({ turnId: Schema.String });
export type PromptOutput = typeof PromptOutputSchema.Type;

// ---------------------------------------------------------------------------
// Session capabilities
// ---------------------------------------------------------------------------

export const SessionCapabilitiesSchema = Schema.Struct({
  models: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) })),
  ),
  commands: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String) }),
    ),
  ),
  mcpServers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
  ),
  supportsResume: Schema.Boolean,
  supportsSteering: Schema.Boolean,
  supportsPermissions: Schema.Boolean,
});
export type SessionCapabilities = typeof SessionCapabilitiesSchema.Type;

// ---------------------------------------------------------------------------
// Agent model (owned by Pi; queried via the live RPC child)
// ---------------------------------------------------------------------------

export const AgentModelSchema = Schema.Struct({
  provider: Schema.String,
  modelId: Schema.String,
  name: Schema.optionalKey(Schema.String),
});
export type AgentModel = typeof AgentModelSchema.Type;

export const AgentModelStateSchema = Schema.Struct({
  provider: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});
export type AgentModelState = typeof AgentModelStateSchema.Type;

export const SetAgentModelInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  provider: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
});
export type SetAgentModelInput = typeof SetAgentModelInputSchema.Type;

export const ListAgentModelsInputSchema = Schema.Struct({
  projectId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
});
export type ListAgentModelsInput = typeof ListAgentModelsInputSchema.Type;

export const ListAgentModelsOutputSchema = Schema.Struct({
  models: Schema.Array(AgentModelSchema),
  defaultModel: Schema.optionalKey(AgentModelSchema),
});
export type ListAgentModelsOutput = typeof ListAgentModelsOutputSchema.Type;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  createdAt: Schema.String,
});
export type Project = typeof ProjectSchema.Type;

/** The project name is derived server-side from the folder's basename. */
export const CreateProjectInputSchema = Schema.Struct({
  path: Schema.String,
});

export const DirectoryEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
});
export type DirectoryEntry = typeof DirectoryEntrySchema.Type;

export const BrowseInputSchema = Schema.Struct({
  path: Schema.optionalKey(Schema.String),
  includeHidden: Schema.optionalKey(Schema.Boolean),
});
export const BrowseResultSchema = Schema.Struct({
  path: Schema.String,
  parent: Schema.Union([Schema.String, Schema.Null]),
  directories: Schema.Array(DirectoryEntrySchema),
});

// ---------------------------------------------------------------------------
// Lifecycle method inputs / outputs
// ---------------------------------------------------------------------------

// Session-scoped config is owned by Pi — there are no session config RPCs.

export const CreateSessionInputSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
  // Create a git worktree and persist its cwd before returning. Request payload,
  // not a stored pending flag — git failure fails create with no session record.
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
});
export type CreateSessionInput = typeof CreateSessionInputSchema.Type;

/** Absolute directory Pi runs in for one session. */
export const SessionWorkspaceSchema = Schema.Struct({
  cwd: Schema.String,
  gitBranch: Schema.optionalKey(Schema.NonEmptyString),
});
export type SessionWorkspace = typeof SessionWorkspaceSchema.Type;

export const CreateSessionOutputSchema = Schema.Struct({
  ref: SessionRefSchema,
  workspace: SessionWorkspaceSchema,
});
export type CreateSessionOutput = typeof CreateSessionOutputSchema.Type;

export const PrepareSessionOutputSchema = CreateSessionOutputSchema;
export type PrepareSessionOutput = typeof PrepareSessionOutputSchema.Type;

export const ListSessionsInputSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  archived: Schema.optionalKey(Schema.Boolean),
});
export type ListSessionsInput = typeof ListSessionsInputSchema.Type;

export type SessionSummary = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly historyAvailable: boolean;
  readonly status?: SessionStatus;
};

/** `session.list` returns the summaries directly — one shape, no wrapper. */
export type ListSessionsOutput = ReadonlyArray<SessionSummary>;

/**
 * Longest title a client may give a session. The title is persisted on the
 * session record and broadcast to every client on rename, so it is bounded
 * here rather than left to whatever a caller sends.
 */
export const MAX_SESSION_TITLE_CHARS = 120;

export const RenameSessionInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  // `isTrimmed` with `isNonEmpty` is what rejects a whitespace-only title: the
  // server stores the string as given, and a blank title would render as an
  // unnamed row that no amount of renaming visibly fixes.
  title: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(MAX_SESSION_TITLE_CHARS),
  ),
});
export type RenameSessionInput = typeof RenameSessionInputSchema.Type;

export const ArchiveSessionInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  archived: Schema.Boolean,
});
export type ArchiveSessionInput = typeof ArchiveSessionInputSchema.Type;

export const RefInputSchema = Schema.Struct({ ref: SessionRefSchema });
export type RefInput = typeof RefInputSchema.Type;

// The server sessionId is globally unique. Clients that only hold a sessionId
// (a bookmarked/reloaded URL) resolve the full SessionRef through this.
export const ResolveRefInputSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isUUID()),
});
export type ResolveRefInput = typeof ResolveRefInputSchema.Type;

export const RespondToAgentRequestInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  requestId: Schema.String,
  response: AgentResponseSchema,
});
export type RespondToAgentRequestInput = typeof RespondToAgentRequestInputSchema.Type;

// ---------------------------------------------------------------------------
// Errors
//
// Shared oRPC error map. New-contract procedures attach it with
// `oc.errors(serverErrors)`; clients branch on the error code, never on the
// message.
// ---------------------------------------------------------------------------

export const ServerErrorCodes = [
  "INVALID_ARGUMENT",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_NOT_ACTIVE",
  "SESSION_CRASHED",
  "CONFLICT",
  "UNSUPPORTED",
  "INTERNAL",
] as const;
export type ServerErrorCode = (typeof ServerErrorCodes)[number];

export const serverErrors = {
  INVALID_ARGUMENT: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  SESSION_NOT_ACTIVE: {},
  SESSION_CRASHED: {},
  CONFLICT: {},
  UNSUPPORTED: {},
  INTERNAL: {},
} as const;
