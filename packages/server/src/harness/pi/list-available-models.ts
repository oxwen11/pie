import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@pie/contract";

import { toAgentModel } from "./model-mapping";

/**
 * Cold model catalogue: same source as `pi --list-models` and RPC
 * `get_available_models` (`ModelRuntime.getAvailable()`), without spawning
 * `pi --mode rpc` or opening a live AgentSession.
 */
export async function listAvailablePiModels(cwd: string): Promise<ReadonlyArray<AgentModel>> {
  const services = await createAgentSessionServices({ cwd });
  const models = await services.modelRuntime.getAvailable();
  return models.map(toAgentModel);
}
