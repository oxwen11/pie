import type { AgentModel, ListAgentModelsOutput } from "@getpie/contract";
import { findExecutable } from "@getpie/core/executable";
import { Duration, Effect, FileSystem, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { AgentOperationError } from "../errors";
import { toAgentModel } from "./model-mapping";
import { resolveDefaultPiModel } from "./resolve-default-model";
import { resolvePiExecutable } from "./resolve-executable";

const LIST_MODELS_TIMEOUT = Duration.seconds(20);

const listModelsError = (cause: unknown) =>
  new AgentOperationError({
    sessionId: "",
    operation: "list-models",
    cause,
  });

/** Parse `pi --list-models` table output. */
export function parsePiListModelsTable(stdout: string): ListAgentModelsOutput {
  const models: AgentModel[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("provider") && trimmed.includes("model")) continue;
    const parts = trimmed.split(/\s{2,}/);
    const provider = parts[0];
    const modelId = parts[1];
    if (provider === undefined || modelId === undefined) continue;
    models.push({ provider, modelId, name: modelId });
  }
  const defaultModel = models[0];
  return defaultModel === undefined ? { models } : { models, defaultModel };
}

const listModelsFromPiCli = (
  cwd: string,
): Effect.Effect<
  ListAgentModelsOutput,
  AgentOperationError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const executable = resolvePiExecutable();
    const found = yield* findExecutable(executable.command);
    const command = found ?? executable.command;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stdout = yield* spawner
      .string(
        ChildProcess.make(command, ["--list-models"], {
          cwd,
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.mapError(listModelsError),
        Effect.timeoutOption(LIST_MODELS_TIMEOUT),
        Effect.flatMap((result) =>
          Option.match(result, {
            onSome: Effect.succeed,
            onNone: () =>
              Effect.fail(listModelsError(new Error("pi --list-models timed out after 20s"))),
          }),
        ),
      );
    const listed = parsePiListModelsTable(stdout);
    if (listed.models.length === 0) {
      return yield* listModelsError(new Error("pi --list-models returned no models"));
    }
    return listed;
  });

/**
 * Typed default-model path for in-repo server. Published `pie` neverBundles
 * `pi-coding-agent`; opt in with `PIE_PI_LIBRARY=1` rather than catching a
 * failed specifier.
 */
const listModelsFromPiLibrary = (
  cwd: string,
): Effect.Effect<ListAgentModelsOutput, AgentOperationError> =>
  Effect.gen(function* () {
    const { createAgentSessionServices } = yield* Effect.tryPromise({
      try: () => import("@earendil-works/pi-coding-agent"),
      catch: listModelsError,
    });
    const services = yield* Effect.tryPromise({
      try: () => createAgentSessionServices({ cwd }),
      catch: listModelsError,
    });
    const available = yield* Effect.tryPromise({
      try: () => services.modelRuntime.getAvailable(),
      catch: listModelsError,
    });
    const models = available.map(toAgentModel);
    const defaultModel = resolveDefaultPiModel(models, services.settingsManager);
    return defaultModel === undefined ? { models } : { models, defaultModel };
  });

/**
 * Available models plus Pi's startup default. Pi is a host install, so the
 * default path is `pi --list-models`.
 */
export function listAvailablePiModels(
  cwd: string,
): Effect.Effect<
  ListAgentModelsOutput,
  AgentOperationError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    if (process.env["PIE_PI_LIBRARY"] === "1") {
      return yield* listModelsFromPiLibrary(cwd);
    }
    return yield* listModelsFromPiCli(cwd);
  }).pipe(Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }));
}
