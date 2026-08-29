import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { AgentModel, AgentModelState, AgentThinkingState } from "@getpie/contract";

import type { RpcSessionState } from "./protocol";

export type PiModel = NonNullable<RpcSessionState["model"]>;

export const toAgentModel = (model: PiModel): AgentModel => ({
  provider: model.provider,
  modelId: model.id,
  name: model.name,
  availableThinkingLevels: getSupportedThinkingLevels(model),
});

export const toAgentModelState = (state: RpcSessionState): AgentModelState =>
  state.model
    ? { provider: state.model.provider, modelId: state.model.id, name: state.model.name }
    : {};

export const toAgentThinkingState = (
  state: RpcSessionState,
  availableLevels: AgentThinkingState["availableLevels"],
): AgentThinkingState => ({
  level: state.thinkingLevel,
  availableLevels,
});
