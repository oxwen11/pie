import { agentContract } from "./agent";
import { assetsContract } from "./assets";
import { fsContract } from "./fs";
import { gitContract } from "./git";
import { packagesContract } from "./packages";
import { projectContract } from "./project";
import { pullRequestContract } from "./pull-request";
import { scheduleContract } from "./schedule";
import { sessionContract } from "./session";
import { settingsContract } from "./settings";
import { skillsContract } from "./skills";
import { terminalContract } from "./terminal";

export * from "./domain";
export { toStandardSchema } from "./orpc";
export type {
  PiTools,
  PieAssistantMetadata,
  PieAssistantUIMessage,
  PieDataTypes,
  PieToolUIPart,
  PieUIMessage,
  PieUIMessageChunk,
  PieUserMetadata,
  PieUserUIMessage,
} from "./pi-tools";
export * from "./packages";
export * from "./project";
export * from "./schedule";
export * from "./settings";
export * from "./skills";
export * from "./terminal";

export const contract = {
  agent: agentContract,
  assets: assetsContract,
  project: projectContract,
  fs: fsContract,
  git: gitContract,
  schedule: scheduleContract,
  settings: settingsContract,
  packages: packagesContract,
  skills: skillsContract,
  pullRequest: pullRequestContract,
  terminal: terminalContract,
};
export type Contract = typeof contract;

export {
  agentContract,
  assetsContract,
  scheduleContract,
  settingsContract,
  fsContract,
  gitContract,
  packagesContract,
  projectContract,
  pullRequestContract,
  sessionContract,
  skillsContract,
  terminalContract,
};
