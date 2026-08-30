import { agentRouter } from "./agent";
import { assetsRouter } from "./assets";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { projectRouter } from "./project";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  agent: agentRouter,
  assets: assetsRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
});
export type Router = typeof router;
