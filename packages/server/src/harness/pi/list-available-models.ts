import type { ListAgentModelsOutput } from "@getpie/contract";
import { Effect } from "effect";

import { AgentOperationError } from "../errors";
import { toAgentModel } from "./model-mapping";
import { PI_PROJECT_LOADER_OPTIONS, PI_PROJECT_SETTINGS_OPTIONS } from "./project-resource-policy";
import { resolveDefaultPiModel } from "./resolve-default-model";

const listModelsError = (cause: unknown) =>
  new AgentOperationError({
    sessionId: "",
    operation: "list-models",
    cause,
  });

/**
 * Available models plus Pi's startup default, from one
 * `createAgentSessionServices` load — same source as `pi --list-models` and
 * RPC `get_available_models`, without spawning pie-pi-process.
 */
export function listAvailablePiModels(
  cwd: string,
): Effect.Effect<ListAgentModelsOutput, AgentOperationError> {
  return Effect.gen(function* () {
    const { createAgentSessionServices, getAgentDir, SettingsManager } = yield* Effect.tryPromise({
      try: () => import("@earendil-works/pi-coding-agent"),
      catch: listModelsError,
    });
    const services = yield* Effect.tryPromise({
      try: () =>
        createAgentSessionServices({
          cwd,
          agentDir: getAgentDir(),
          settingsManager: SettingsManager.create(cwd, getAgentDir(), PI_PROJECT_SETTINGS_OPTIONS),
          resourceLoaderOptions: PI_PROJECT_LOADER_OPTIONS,
        }),
      catch: listModelsError,
    });
    const available = yield* Effect.tryPromise({
      try: () => services.modelRuntime.getAvailable(),
      catch: listModelsError,
    });
    const models = available.map(toAgentModel);
    const defaultModel = resolveDefaultPiModel(models, services.settingsManager);
    return defaultModel === undefined ? { models } : { models, defaultModel };
  }).pipe(Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }));
}
