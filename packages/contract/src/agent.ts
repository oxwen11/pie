import { oc } from "@orpc/contract";

import {
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  serverErrors,
  toStandardSchema,
} from "./domain";
import { sessionContract } from "./session";

const base = oc.errors(serverErrors);

export const agentContract = {
  listModels: base
    .input(toStandardSchema(ListAgentModelsInputSchema))
    .output(toStandardSchema(ListAgentModelsOutputSchema)),
  session: sessionContract,
};
