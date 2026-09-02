import { agentRouter } from "./agent";
import { automationRouter } from "./automation";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { projectRouter } from "./project";
import { pullRequestRouter } from "./pull-request";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  automation: automationRouter,
  pullRequest: pullRequestRouter,
});
export type Router = typeof router;
