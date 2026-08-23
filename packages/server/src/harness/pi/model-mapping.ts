import type { AgentModel, AgentModelState } from "@pie/contract";

import type { RpcSessionState } from "./protocol";

export type PiModel = NonNullable<RpcSessionState["model"]>;

export const toAgentModel = (model: PiModel): AgentModel => ({
  provider: model.provider,
  modelId: model.id,
  name: model.name,
});

export const toAgentModelState = (state: RpcSessionState): AgentModelState =>
  state.model ? toAgentModel(state.model) : {};
