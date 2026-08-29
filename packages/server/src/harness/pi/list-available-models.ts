import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";

import { toAgentModel } from "./model-mapping";
import { resolveDefaultPiModel } from "./resolve-default-model";

export type PiModelCatalog = {
  readonly models: ReadonlyArray<AgentModel>;
  readonly defaultModel: AgentModel | undefined;
};

/**
 * Available models plus Pi's startup default, from one
 * `createAgentSessionServices` load. No RPC child.
 */
export async function listAvailablePiModels(cwd: string): Promise<PiModelCatalog> {
  const services = await createAgentSessionServices({ cwd });
  const available = await services.modelRuntime.getAvailable();
  const models = available.map(toAgentModel);
  const defaultModel = resolveDefaultPiModel(models, services.settingsManager);
  return { models, defaultModel };
}
