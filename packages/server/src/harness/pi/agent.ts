import type { PieUIMessage } from "@getpie/contract";
import { Context, Effect, FileSystem, type Scope } from "effect";

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
  readonly availability: Effect.Effect<AvailabilityResult>;
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
  readonly getMessages?: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<ReadonlyArray<PieUIMessage>, AgentOperationError>;
  readonly getSessionInfo: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<SessionInfoResult, AgentOperationError>;
};

const gateOnAvailability = <A, E, R>(
  availability: Effect.Effect<AvailabilityResult>,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | AgentUnavailable, R> =>
  Effect.gen(function* () {
    const result = yield* availability;
    if (!result.available) {
      return yield* new AgentUnavailable({ reason: result.reason ?? "Unavailable" });
    }
    return yield* body;
  });

/**
 * `Effect.cached` stores the first exit forever. Without the uninterruptible
 * guard, a caller interrupted mid-check stores that interruption and every
 * later call replays it as a defect until the process restarts.
 */
export const cachePiAgentAvailability = <A, E, R>(
  check: Effect.Effect<A, E, R>,
): Effect.Effect<Effect.Effect<A, E, R>, never, R> =>
  Effect.map(Effect.cached(check), (cached) => Effect.uninterruptible(cached));

export const makePiAgent = (
  piProcess: PiProcess,
  options: { readonly executable?: PiExecutable } = {},
): Effect.Effect<PiAgentShape, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const availability = yield* cachePiAgentAvailability(
      checkPiAvailability(options.executable ?? { command: process.execPath, prefixArgs: [] }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      ),
    );

    return {
      availability,
      create: (input) => gateOnAvailability(availability, createPiAgentRuntime(piProcess, input)),
      resume: (input) => gateOnAvailability(availability, resumePiAgentRuntime(piProcess, input)),
      getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
    };
  });

export class PiAgent extends Context.Service<PiAgent, PiAgentShape>()("PiAgent") {}
