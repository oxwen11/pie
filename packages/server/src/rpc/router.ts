import { os } from "@orpc/server";

import { agentRouter } from "./agent";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { projectRouter } from "./project";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  project: projectRouter,
  fs: fsRouter,
});
export type Router = typeof router;
