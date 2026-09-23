import type { PieUIMessage } from "@getpie/contract";
import { Context, Effect, Option, type FileSystem, type Scope } from "effect";

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
import { PiSessionTools } from "./session-tools";
import type { SessionInfoResult } from "./types";

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
  readonly getMessages?: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<ReadonlyArray<PieUIMessage>, AgentOperationError>;
  readonly getSessionInfo: (
    agentSessionId: string,
    cwd?: string,
  ) => Effect.Effect<SessionInfoResult, AgentOperationError>;
};

export const makePiAgent = (
  piProcess: PiProcess,
  options: { readonly executable?: PiExecutable } = {},
): Effect.Effect<PiAgentShape, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const checked = yield* checkPiAvailability(
      options.executable ?? { command: process.execPath, prefixArgs: [] },
    );
    const blocked = checked.available
      ? undefined
      : new AgentUnavailable({ reason: checked.reason ?? "Unavailable" });
    const gate = <A, E, R>(body: Effect.Effect<A, E, R>) =>
      blocked === undefined ? body : Effect.fail(blocked);
    const tools = Effect.serviceOption(PiSessionTools).pipe(Effect.map(Option.getOrUndefined));

    return {
      create: (input) =>
        gate(
          Effect.flatMap(tools, (sessionTools) =>
            createPiAgentRuntime(piProcess, input, sessionTools),
          ),
        ),
      resume: (input) =>
        gate(
          Effect.flatMap(tools, (sessionTools) =>
            resumePiAgentRuntime(piProcess, input, sessionTools),
          ),
        ),
      getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
    };
  });

export class PiAgent extends Context.Service<PiAgent, PiAgentShape>()("PiAgent") {}
