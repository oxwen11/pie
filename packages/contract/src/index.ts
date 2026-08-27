import { agentContract } from "./agent";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { projectContract } from "./project";
import { scheduleContract } from "./schedule";
import { sessionContract } from "./session";

export * from "./domain";
export * from "./project";
export * from "./schedule";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  schedule: scheduleContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  fsContract,
  gitContract,
  projectContract,
  scheduleContract,
  sessionContract,
};
