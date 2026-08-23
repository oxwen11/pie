import { agentContract } from "./agent";
import { fsContract } from "./fs";
import { projectContract } from "./project";
import { sessionContract } from "./session";

export * from "./domain";
export * from "./project";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
};
export type Contract = typeof contract;

export { agentContract, fsContract, projectContract, sessionContract };
