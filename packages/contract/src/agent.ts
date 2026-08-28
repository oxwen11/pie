import {
  AgentModelStateSchema,
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  SetDefaultAgentModelInputSchema,
  serverErrors,
} from "./domain";
import { oc } from "./orpc";
import { sessionContract } from "./session";

const base = oc.errors(serverErrors);

export const agentContract = {
  listModels: base.input(ListAgentModelsInputSchema).output(ListAgentModelsOutputSchema),
  setDefaultModel: base.input(SetDefaultAgentModelInputSchema).output(AgentModelStateSchema),
  session: sessionContract,
};
