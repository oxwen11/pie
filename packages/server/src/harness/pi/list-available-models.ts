import {
  createAgentSessionServices,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";

import { toAgentModel } from "./model-mapping";
import { PI_PROJECT_LOADER_OPTIONS, PI_PROJECT_SETTINGS_OPTIONS } from "./project-resource-policy";
import { resolveDefaultPiModel } from "./resolve-default-model";

export type PiModelList = {
  readonly models: ReadonlyArray<AgentModel>;
  readonly defaultModel: AgentModel | undefined;
};

/**
 * Cold model discovery: same source as `pi --list-models` and RPC
 * `get_available_models` (`ModelRuntime.getAvailable()`), without spawning
 * `pi --mode rpc` or opening a live AgentSession. Without a Project, the agent
 * directory is used as a neutral cwd.
 */
export async function listAvailablePiModels(cwd?: string): Promise<PiModelList> {
  const agentDir = getAgentDir();
  const effectiveCwd = cwd ?? agentDir;
  const settingsManager = SettingsManager.create(
    effectiveCwd,
    agentDir,
    PI_PROJECT_SETTINGS_OPTIONS,
  );
  const services = await createAgentSessionServices({
    cwd: effectiveCwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: PI_PROJECT_LOADER_OPTIONS,
  });
  const models = (await services.modelRuntime.getAvailable()).map(toAgentModel);
  const defaultModel = await resolveDefaultPiModel(services);
  return { models, defaultModel };
}
