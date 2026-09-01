import { oc } from "@orpc/contract";

import {
  ListAgentCommandsInputSchema,
  ListAgentCommandsOutputSchema,
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  serverErrors,
  toStandardSchema,
} from "./domain";
import { sessionContract } from "./session";

const base = oc.errors(serverErrors);

export const agentContract = {
  commands: base
    .input(toStandardSchema(ListAgentCommandsInputSchema))
    .output(toStandardSchema(ListAgentCommandsOutputSchema)),
  listModels: base
    .input(toStandardSchema(ListAgentModelsInputSchema))
    .output(toStandardSchema(ListAgentModelsOutputSchema)),
  session: sessionContract,
};
