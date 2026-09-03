import type { AgentModel, AgentModelState } from "@getpie/contract";

import type { RpcSessionState } from "./protocol";

export type PiModel = NonNullable<RpcSessionState["model"]>;

export type PiModelRef = {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
};

export const toAgentModel = (model: PiModelRef): AgentModel => ({
  provider: model.provider,
  modelId: model.id,
  name: model.name,
});

export const toAgentModelState = (state: RpcSessionState): AgentModelState =>
  state.model ? toAgentModel(state.model) : {};
