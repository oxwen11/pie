import { Effect, Option, type FileSystem } from "effect";

import { AgentUnavailable } from "../harness/errors";
import { PiSessionTools, type PiAgentShape, type SessionInfoResult } from "../harness/pi-port";
import type { PiProcess } from "./process";
import { persistDefaultPiModel } from "./resolve-default-model";
import { checkPiAvailability } from "./resolve-executable";
import type { PiExecutable } from "./resolve-executable";
import { createPiAgentRuntime, resumePiAgentRuntime } from "./runtime";
import { readPiSessionFile } from "./session-file";

export { PiAgent, type PiAgentShape } from "../harness/pi-port";

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
      getMessages: (agentSessionId, cwd) =>
        readPiSessionFile(agentSessionId, cwd ?? "").pipe(Effect.map((value) => value.messages)),
      getModelState: (agentSessionId, cwd) =>
        readPiSessionFile(agentSessionId, cwd ?? "").pipe(
          Effect.map((value) => value.model),
          Effect.catchTag("SessionNotResumable", () => Effect.succeed({})),
        ),
      setDefaultModel: (provider, modelId) =>
        Effect.tryPromise({
          try: () => persistDefaultPiModel(provider, modelId),
          catch: (cause) => cause,
        }),
      getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
    };
  });
