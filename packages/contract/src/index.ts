import { agentContract } from "./agent";
import { automationContract } from "./automation";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { sessionContract } from "./session";

export * from "./domain";
export * from "./project";
export * from "./automation";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  automation: automationContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  fsContract,
  gitContract,
  projectContract,
  automationContract,
  sessionContract,
};
