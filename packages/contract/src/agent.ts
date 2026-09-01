import {
  ListAgentCommandsInputSchema,
  ListAgentCommandsOutputSchema,
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  serverErrors,
} from "./domain";
import { oc } from "./orpc";
import { sessionContract } from "./session";

const base = oc.errors(serverErrors);

export const agentContract = {
  commands: base.input(ListAgentCommandsInputSchema).output(ListAgentCommandsOutputSchema),
  listModels: base.input(ListAgentModelsInputSchema).output(ListAgentModelsOutputSchema),
  session: sessionContract,
};
