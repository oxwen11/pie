import { agentContract } from "./agent";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { sessionContract } from "./session";
import { settingsContract } from "./settings";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export * from "./project";
export * from "./settings";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  settings: settingsContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  fsContract,
  gitContract,
  projectContract,
  sessionContract,
  settingsContract,
};
