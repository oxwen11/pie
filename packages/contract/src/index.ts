import { agentContract } from "./agent";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { pluginContract } from "./plugin";
import { projectContract } from "./project";
import { pullRequestContract } from "./pull-request";
import { scheduleContract } from "./schedule";
import { sessionContract } from "./session";
import { terminalContract } from "./terminal";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export * from "./plugin";
export * from "./project";
export * from "./schedule";
export * from "./terminal";

export const contract = {
  agent: agentContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  plugin: pluginContract,
  schedule: scheduleContract,
  pullRequest: pullRequestContract,
  terminal: terminalContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  scheduleContract,
  fsContract,
  gitContract,
  pluginContract,
  projectContract,
  pullRequestContract,
  sessionContract,
  terminalContract,
};
