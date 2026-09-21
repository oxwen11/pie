import { agentRouter } from "./agent";
import { assetsRouter } from "./assets";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { packagesRouter } from "./packages";
import { projectRouter } from "./project";
import { pullRequestRouter } from "./pull-request";
import { scheduleRouter } from "./schedule";
import { settingsRouter } from "./settings";
import { skillsRouter } from "./skills";
import { terminalRouter } from "./terminal";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  assets: assetsRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  schedule: scheduleRouter,
  settings: settingsRouter,
  packages: packagesRouter,
  skills: skillsRouter,
  pullRequest: pullRequestRouter,
  terminal: terminalRouter,
});
export type Router = typeof router;
