import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { ListAgentModelsOutput } from "@getpie/contract";

import { toAgentModel } from "./model-mapping";
import { resolveDefaultPiModel } from "./resolve-default-model";

/**
 * Available models plus Pi's startup default, from one
 * `createAgentSessionServices` load. No RPC child.
 */
export async function listAvailablePiModels(cwd: string): Promise<ListAgentModelsOutput> {
  const services = await createAgentSessionServices({ cwd });
  const available = await services.modelRuntime.getAvailable();
  const models = available.map(toAgentModel);
  const defaultModel = resolveDefaultPiModel(models, services.settingsManager);
  return defaultModel === undefined ? { models } : { models, defaultModel };
}
