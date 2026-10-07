import { agentRouter } from "./agent";
import { assetsRouter } from "./assets";
import type { RpcContext } from "./context";
import { fsRouter } from "./fs";
import { gitRouter } from "./git";
import { os } from "./orpc";
import { packagesRouter } from "./packages";
import { projectRouter } from "./project";
import { prRouter, pullRequestRouter } from "./pull-request";
import { scheduleRouter } from "./schedule";
import { sessionRootRouter, sessionRouter } from "./session";
import { settingsRouter } from "./settings";
import { skillsRouter } from "./skills";
import { terminalRouter } from "./terminal";

const orpc = os.$context<RpcContext>();

export const router = orpc.router({
  run: sessionRootRouter.run,
  send: sessionRootRouter.send,
  ls: sessionRootRouter.ls,
  logs: sessionRootRouter.logs,
  wait: sessionRootRouter.wait,
  interrupt: sessionRootRouter.interrupt,
  session: sessionRouter,
  agent: agentRouter,
  assets: assetsRouter,
  project: projectRouter,
  fs: fsRouter,
  git: gitRouter,
  schedule: scheduleRouter,
  settings: settingsRouter,
  packages: packagesRouter,
  skills: skillsRouter,
  pr: prRouter,
  pullRequest: pullRequestRouter,
  terminal: terminalRouter,
});
export type Router = typeof router;
