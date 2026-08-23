import type {
  AgentResponse,
  InspectorTarget,
  SessionCapabilities,
  AgentModelState,
} from "@pie/contract";
import { InspectorTargetSchema, SessionCapabilitiesSchema } from "@pie/contract";
import type { UIMessage } from "ai";
import { Effect, type FileSystem, type Scope, type Stream } from "effect";

import { AgentOpenError } from "./errors";
import type {
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
import {
  CreateSessionInputSchema,
  PromptReceiptSchema,
  ResumeSessionInputSchema,
  UserInputPartSchema,
  UserInputSchema,
  type CreateSessionInput,
  type PromptReceipt,
  type ResumeSessionInput,
  type UserInput,
  type UserInputPart,
} from "./session-io";

export {
  CreateSessionInputSchema,
  InspectorTargetSchema,
  PromptReceiptSchema,
  ResumeSessionInputSchema,
  SessionCapabilitiesSchema,
  UserInputPartSchema,
  UserInputSchema,
};
export type {
  CreateSessionInput,
  InspectorTarget,
  PromptReceipt,
  ResumeSessionInput,
  SessionCapabilities,
  UserInput,
  UserInputPart,
};

export type AgentDescriptor = {
  readonly name: string;
};

export type AvailabilityResult = {
  readonly available: boolean;
  readonly reason?: string;
};

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

/** Live Pi child process: events, prompt, interrupt, and close. */
export interface HarnessAgentRuntime {
  readonly sessionId: string;
  readonly events: Stream.Stream<SessionEnvelopeDraft, AgentOperationError>;
  readonly prompt: (
    input: UserInput,
  ) => Effect.Effect<PromptReceipt, SessionClosed | TurnAlreadyRunning | AgentOperationError>;
  readonly interrupt: Effect.Effect<void, SessionClosed | AgentOperationError>;
  readonly respondToAgentRequest: (
    requestId: string,
    response: AgentResponse,
  ) => Effect.Effect<void, AgentRequestUnavailable | AgentOperationError>;
  readonly getCapabilities: Effect.Effect<
    SessionCapabilities,
    CapabilityUnsupported | AgentOperationError
  >;
  /** Warm history read from a live Pi child (`get_entries`). */
  readonly getMessages?: Effect.Effect<
    ReadonlyArray<UIMessage>,
    SessionClosed | AgentOperationError
  >;
  readonly getModelState?: Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly setModel?: (model: {
    readonly provider: string;
    readonly modelId: string;
  }) => Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly close: Effect.Effect<void>;
}

/** Pi session driver: availability check, open, resume, and cold reads. */
export interface HarnessAgentAdapter {
  readonly descriptor: AgentDescriptor;
  readonly checkAvailability: Effect.Effect<AvailabilityResult, never, FileSystem.FileSystem>;
  readonly open: (
    input: CreateSessionInput,
  ) => Effect.Effect<
    HarnessAgentRuntime,
    AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope
  >;
  readonly resume: (
    input: ResumeSessionInput,
  ) => Effect.Effect<
    HarnessAgentRuntime,
    SessionNotResumable | AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope
  >;
  readonly getMessages?: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<ReadonlyArray<UIMessage>, AgentOperationError>;
  readonly getSessionInfo: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<SessionInfoResult, AgentOperationError>;
}
