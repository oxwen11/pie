import type { UIMessage } from "ai";
import { Context, Effect, type FileSystem, type Scope } from "effect";

import {
  AgentOpenError,
  AgentUnavailable,
  type AgentOperationError,
  type ExecutableNotFound,
  type SessionNotResumable,
} from "../errors";
import type { CreateSessionInput, ResumeSessionInput } from "../session-io";
import type { PiProcess } from "./process";
import { checkPiAvailability } from "./resolve-executable";
import type { PiExecutable } from "./resolve-executable";
import { createPiAgentRuntime, resumePiAgentRuntime, type PiAgentRuntime } from "./runtime";
import type { AvailabilityResult, SessionInfoResult } from "./types";

/** Injected PiAgent service — create, resume, and cold reads at the composition root. */
export type PiAgentShape = {
  readonly availability: Effect.Effect<AvailabilityResult, never, FileSystem.FileSystem>;
  readonly create: (
    input: CreateSessionInput,
  ) => Effect.Effect<
    PiAgentRuntime,
    AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope | FileSystem.FileSystem
  >;
  readonly resume: (
    input: ResumeSessionInput,
  ) => Effect.Effect<
    PiAgentRuntime,
    SessionNotResumable | AgentUnavailable | ExecutableNotFound | AgentOpenError,
    Scope.Scope | FileSystem.FileSystem
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

const whenAvailable = <A, E, R>(
  availability: Effect.Effect<AvailabilityResult, never, FileSystem.FileSystem>,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | AgentUnavailable, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const result = yield* availability;
    if (!result.available) {
      return yield* Effect.fail(new AgentUnavailable({ reason: result.reason ?? "Unavailable" }));
    }
    return yield* body;
  });

type MutableAvailability = {
  availability: Effect.Effect<AvailabilityResult, never, FileSystem.FileSystem>;
};

export const makePiAgent = (
  process: PiProcess,
  options: { readonly executable?: PiExecutable } = {},
): PiAgentShape => {
  const pi: MutableAvailability & Omit<PiAgentShape, "availability"> = {
    availability: checkPiAvailability(options.executable ?? { command: "pi", prefixArgs: [] }),
    create: (input) => whenAvailable(pi.availability, createPiAgentRuntime(process, input)),
    resume: (input) => whenAvailable(pi.availability, resumePiAgentRuntime(process, input)),
    getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
  };
  return pi;
};

export class PiAgent extends Context.Service<PiAgent, PiAgentShape>()("PiAgent") {}

export const cachePiAgentAvailability = (
  pi: PiAgentShape,
): Effect.Effect<PiAgentShape, never, FileSystem.FileSystem> =>
  Effect.map(Effect.cached(pi.availability), (cachedCheck) => {
    (pi as MutableAvailability).availability = Effect.uninterruptible(cachedCheck);
    return pi;
  });
