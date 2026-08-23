import { oc } from "@orpc/contract";

import {
  ListAgentModelsInputSchema,
  ListAgentModelsOutputSchema,
  serverErrors,
  toStandardSchema,
} from "./domain";
import { sessionContract } from "./session";

const base = oc.errors(serverErrors);

/**
 * Pi agent RPC: the cold model catalog plus the live session instance
 * namespace. Session procedures are nested so the wire path is
 * `agent.session.*` rather than a sibling of `agent`.
 */
export const agentContract = {
  listModels: base
    .input(toStandardSchema(ListAgentModelsInputSchema))
    .output(toStandardSchema(ListAgentModelsOutputSchema)),
  session: sessionContract,
};
