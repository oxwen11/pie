import { agentRouter } from "./agent";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { projectRouter } from "./project";
import { pullRequestRouter } from "./pull-request";
import { scheduleRouter } from "./schedule";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  schedule: scheduleRouter,
  pullRequest: pullRequestRouter,
});
export type Router = typeof router;
