import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";

import { toAgentModel } from "./model-mapping";
import { resolveDefaultPiModel } from "./resolve-default-model";

export type PiModelCatalog = {
  readonly models: ReadonlyArray<AgentModel>;
  readonly defaultModel: AgentModel | undefined;
};

/**
 * Cold model catalogue: same source as `pi --list-models` and process
 * `get_available_models` (`ModelRuntime.getAvailable()`), without spawning
 * a live Pi process or opening an AgentSession.
 */
export async function listAvailablePiModels(cwd: string): Promise<PiModelCatalog> {
  const services = await createAgentSessionServices({ cwd });
  const available = await services.modelRuntime.getAvailable();
  const models = available.map(toAgentModel);
  const defaultModel = await resolveDefaultPiModel(services);
  return { models, defaultModel };
}
