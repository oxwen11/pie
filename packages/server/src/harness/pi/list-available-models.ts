import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";
import { Effect } from "effect";

import { AgentOperationError } from "../errors";
import { toAgentModel } from "./model-mapping";
import { resolveDefaultPiModel } from "./resolve-default-model";

export type PiModelCatalog = {
  readonly models: ReadonlyArray<AgentModel>;
  readonly defaultModel: AgentModel | undefined;
};

const listModelsError = (cause: unknown) =>
  new AgentOperationError({
    sessionId: "",
    operation: "list-models",
    cause,
  });

/**
 * Cold model catalogue: same source as `pi --list-models` and RPC
 * `get_available_models` (`ModelRuntime.getAvailable()`), without spawning
 * `pi --mode rpc` or opening a live AgentSession.
 */
export function listAvailablePiModels(
  cwd: string,
): Effect.Effect<PiModelCatalog, AgentOperationError> {
  return Effect.gen(function* () {
    const services = yield* Effect.tryPromise({
      try: () => createAgentSessionServices({ cwd }),
      catch: listModelsError,
    });
    const available = yield* Effect.tryPromise({
      try: () => services.modelRuntime.getAvailable(),
      catch: listModelsError,
    });
    const models = available.map(toAgentModel);
    const defaultModel = resolveDefaultPiModel(services, available);
    return { models, defaultModel };
  }).pipe(Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }));
}
