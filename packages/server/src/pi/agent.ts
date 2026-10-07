import { Effect, type FileSystem } from "effect";

import { AgentUnavailable } from "../harness/errors";
import type { PiAgentShape, SessionInfoResult } from "../harness/pi-port";
import type { PiProcess } from "./process";
import { persistDefaultPiModel } from "./resolve-default-model";
import { checkPiAvailability } from "./resolve-executable";
import type { PiExecutable } from "./resolve-executable";
import { createPiAgentRuntime, resumePiAgentRuntime } from "./runtime";
import { readPiSessionFile } from "./session-file";

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

    return {
      create: (input) => gate(createPiAgentRuntime(piProcess, input)),
      resume: (input) => gate(resumePiAgentRuntime(piProcess, input)),
      readSession: (agentSessionId, cwd) => readPiSessionFile(agentSessionId, cwd),
      setDefaultModel: (provider, modelId) =>
        Effect.tryPromise({
          try: () => persistDefaultPiModel(provider, modelId),
          catch: (cause) => cause,
        }),
      getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
    };
  });
