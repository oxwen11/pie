import { agentContract } from "./agent";
import { automationContract } from "./automation";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { pullRequestContract } from "./pull-request";
import { sessionContract } from "./session";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export * from "./project";
export * from "./automation";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  automation: automationContract,
  pullRequest: pullRequestContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  automationContract,
  fsContract,
  gitContract,
  projectContract,
  pullRequestContract,
  sessionContract,
};
