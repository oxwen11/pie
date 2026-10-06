import type {
  AgentModelState,
  AgentResponse,
  PieUIMessage,
  SessionCapabilities,
  SessionPendingPrompt,
} from "@getpie/contract";
import type { PullRequestRef, SessionPullRequestLink } from "@getpie/contract/pull-request";
import { Context, Effect, type Scope, Stream } from "effect";

import type {
  AgentOpenError,
  AgentOperationError,
  AgentRequestUnavailable,
  AgentUnavailable,
  CapabilityUnsupported,
  ExecutableNotFound,
  SessionClosed,
  SessionNotResumable,
  TurnAlreadyRunning,
} from "./errors";
import type { SessionEnvelopeDraft } from "./events/framework";
import type {
  CreateSessionInput,
  ResumeSessionInput,
  RuntimePromptReceipt,
  UserInput,
} from "./session-io";

/** Live display data for a session, fetched from Pi at list time. */
export type AgentSessionInfo = {
  readonly title?: string;
  readonly updatedAt?: number;
};

/**
 * Result of looking up a persisted session's Pi backend info:
 * - `found`       — Pi still has it; `info` carries display fields
 * - `missing`     — Pi transcript is gone (deleted); not resumable
 * - `unsupported` — Pi cannot query session info (treat as unknown)
 */
export type SessionInfoResult =
  | { readonly _tag: "found"; readonly info: AgentSessionInfo }
  | { readonly _tag: "missing" }
  | { readonly _tag: "unsupported" };

/** Live Pi child for one agent session: events, prompt, interrupt, and close. */
export type PiAgentRuntime = {
  readonly sessionId: string;
  readonly events: Stream.Stream<SessionEnvelopeDraft, AgentOperationError>;
  readonly prompt: (
    input: UserInput,
  ) => Effect.Effect<
    RuntimePromptReceipt,
    SessionClosed | TurnAlreadyRunning | AgentOperationError
  >;
  readonly interrupt: Effect.Effect<void, SessionClosed | AgentOperationError>;
  readonly replaceQueue: (
    pending: SessionPendingPrompt,
  ) => Effect.Effect<void, SessionClosed | AgentOperationError>;
  readonly respondToAgentRequest: (
    requestId: string,
    response: AgentResponse,
  ) => Effect.Effect<void, AgentRequestUnavailable | AgentOperationError>;
  readonly getCapabilities: Effect.Effect<
    SessionCapabilities,
    CapabilityUnsupported | AgentOperationError
  >;
  readonly getMessages: Effect.Effect<
    ReadonlyArray<PieUIMessage>,
    SessionClosed | AgentOperationError
  >;
  readonly getModelState: Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly setModel: (model: {
    readonly provider: string;
    readonly modelId: string;
  }) => Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly close: Effect.Effect<void>;
};

/** Injected PiAgent service — create, resume, and cold reads at the composition root. */
export type PiAgentShape = {
  readonly create: (
    input: CreateSessionInput,
  ) => Effect.Effect<
    PiAgentRuntime,
    AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope
  >;
  readonly resume: (
    input: ResumeSessionInput,
  ) => Effect.Effect<
    PiAgentRuntime,
    SessionNotResumable | AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope
  >;
  readonly readSession?: (
    agentSessionId: string,
    cwd: string,
  ) => Effect.Effect<
    { readonly messages: ReadonlyArray<PieUIMessage>; readonly model: AgentModelState },
    AgentOperationError | SessionNotResumable
  >;
  readonly setDefaultModel?: (provider: string, modelId: string) => Effect.Effect<void, unknown>;
  readonly getSessionInfo: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<SessionInfoResult, AgentOperationError>;
};

export class PiAgent extends Context.Service<PiAgent, PiAgentShape>()("PiAgent") {}

/** Callbacks capture the validated SessionRef and await the Session service's durable writes. */
export type PiSessionToolsShape = {
  readonly list: Effect.Effect<ReadonlyArray<SessionPullRequestLink>, unknown>;
  readonly register: (
    ref: PullRequestRef,
    restore: boolean,
  ) => Effect.Effect<"linked" | "exists" | "excluded", unknown>;
  readonly exclude: (ref: PullRequestRef) => Effect.Effect<void, unknown>;
};

/** Supplied at runtime acquisition, never a dependency of PiAgent's construction layer. */
export class PiSessionTools extends Context.Service<PiSessionTools, PiSessionToolsShape>()(
  "PiSessionTools",
) {}
