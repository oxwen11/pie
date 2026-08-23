import type { UIMessage } from "ai";
import { Context, Effect, Layer, type FileSystem, type Scope } from "effect";

import {
  AgentOpenError,
  type AgentOperationError,
  type AgentUnavailable,
  type ExecutableNotFound,
  type SessionNotResumable,
} from "../errors";
import type { CreateSessionInput, ResumeSessionInput } from "../session-io";
import type { PiProcess } from "./process";
import { checkPiAvailability } from "./resolve-executable";
import type { PiExecutable } from "./resolve-executable";
import { openPiAgentRuntime, resumePiAgentRuntime, type PiAgentRuntime } from "./runtime";
import type { AvailabilityResult, SessionInfoResult } from "./types";

/** Pi facade injected at the composition root — open, resume, and cold reads. */
export type PiAgentShape = {
  readonly checkAvailability: Effect.Effect<AvailabilityResult, never, FileSystem.FileSystem>;
  readonly open: (
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
  readonly getMessages?: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<ReadonlyArray<UIMessage>, AgentOperationError>;
  readonly getSessionInfo: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<SessionInfoResult, AgentOperationError>;
};

export const makePiAgent = (
  process: PiProcess,
  options: { readonly executable?: PiExecutable } = {},
): PiAgentShape => ({
  checkAvailability: checkPiAvailability(options.executable ?? { command: "pi", prefixArgs: [] }),
  open: (input) => openPiAgentRuntime(process, input),
  resume: (input) => resumePiAgentRuntime(process, input),
  getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
});

export class PiAgent extends Context.Service<PiAgent, PiAgentShape>()("PiAgent") {}

export const cachePiAgentAvailability = (
  pi: PiAgentShape,
): Effect.Effect<PiAgentShape, never, FileSystem.FileSystem> =>
  Effect.map(Effect.cached(pi.checkAvailability), (cachedCheck) => ({
    ...pi,
    checkAvailability: Effect.uninterruptible(cachedCheck),
  }));

export const PiAgentLayer = (pi: PiAgentShape): Layer.Layer<PiAgent> => Layer.succeed(PiAgent, pi);
