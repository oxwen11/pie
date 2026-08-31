import { os } from "@orpc/server";

import { agentRouter } from "./agent";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { projectRouter } from "./project";
import { pullRequestRouter } from "./pull-request";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  pullRequest: pullRequestRouter,
});
export type Router = typeof router;
