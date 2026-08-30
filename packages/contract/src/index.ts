import { agentContract } from "./agent";
import { assetsContract } from "./assets";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
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
};
export type Contract = typeof contract;

export { agentContract, assetsContract, fsContract, gitContract, projectContract, sessionContract };
