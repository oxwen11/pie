import type { ListAgentModelsOutput } from "@getpie/contract";
import { Effect } from "effect";

import { AgentOperationError } from "../errors";
import { toAgentModel } from "./model-mapping";
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
 * RPC `get_available_models`, without spawning `pi --mode rpc`.
 */
export function listAvailablePiModels(
  cwd: string,
): Effect.Effect<ListAgentModelsOutput, AgentOperationError> {
  return Effect.gen(function* () {
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
  }).pipe(Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }));
}
