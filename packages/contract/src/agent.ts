import { oc } from "@orpc/contract";

import {
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  serverErrors,
  toStandardSchema,
} from "./domain";

const base = oc.errors(serverErrors);

/** Pi agent capabilities that are not tied to a live session instance. */
export const agentContract = {
  listModels: base
    .input(toStandardSchema(ListAgentModelsInputSchema))
    .output(toStandardSchema(ListAgentModelsOutputSchema)),
};
