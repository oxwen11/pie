import { agentContract } from "./agent";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { pullRequestContract } from "./pull-request";
import { scheduleContract } from "./schedule";
import { sessionContract } from "./session";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export * from "./project";
export * from "./schedule";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  schedule: scheduleContract,
  pullRequest: pullRequestContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  scheduleContract,
  fsContract,
  gitContract,
  projectContract,
  pullRequestContract,
  sessionContract,
};
