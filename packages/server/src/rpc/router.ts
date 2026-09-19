import { agentRouter } from "./agent";
import { assetsRouter } from "./assets";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { projectRouter } from "./project";
import { pullRequestRouter } from "./pull-request";
import { scheduleRouter } from "./schedule";
import { terminalRouter } from "./terminal";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  assets: assetsRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  schedule: scheduleRouter,
  pullRequest: pullRequestRouter,
  terminal: terminalRouter,
});
export type Router = typeof router;
