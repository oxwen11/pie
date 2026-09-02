import { agentContract } from "./agent";
import { assetsContract } from "./assets";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { pullRequestContract } from "./pull-request";
import { sessionContract } from "./session";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export * from "./project";

export const contract = {
  agent: agentContract,
  assets: assetsContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  pullRequest: pullRequestContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  assetsContract,
  fsContract,
  gitContract,
  projectContract,
  pullRequestContract,
  sessionContract,
};
