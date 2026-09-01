import type { SurfaceIdentity } from "./identity.ts";
import type { RunMeta } from "./meta.ts";
import type { SampleProject } from "./runtime/scaffold.ts";

export type LaunchRequest = {
  replace: boolean;
  mode?: "daemon" | "serve";
};

export type PortPlan = {
  piePort: number;
  vitePort?: number;
  cdpPort?: number;
  refuseTaken: number[];
  warnTaken: number[];
};

export type LaunchCtx = {
  repo: string;
  runId: string;
  runDir: string;
  pieHome: string;
  daemonDir?: string;
  piePort: number;
  vitePort?: number;
  cdpPort?: number;
  request: LaunchRequest;
  sample?: SampleProject;
  env: NodeJS.ProcessEnv;
};

export type SurfaceDefinition = {
  identity: SurfaceIdentity;
  usage: string;
  evidenceUsage: string;
  parseLaunch: (args: string[]) => LaunchRequest;
  ensureBuilt: (repo: string) => void | Promise<void>;
  preflight?: () => void;
  portPlan: () => PortPlan;
  canReuse?: (meta: RunMeta, request: LaunchRequest) => boolean;
  isHealthy: (runDir: string, meta: RunMeta, request: LaunchRequest) => Promise<boolean>;
  livePids: (runDir: string, meta: RunMeta | undefined) => number[];
  initialMeta: (ctx: LaunchCtx) => RunMeta;
  spawn: (ctx: LaunchCtx) => Promise<void>;
  inspect: (runDir: string, meta: RunMeta) => Promise<string[]>;
  stop: (runDir: string, meta: RunMeta | undefined) => Promise<void>;
  afterEvidenceInit?: (dest: string, runDir: string, meta: RunMeta) => void;
  evidenceExtra?: (
    command: string,
    rest: string[],
    dest: string,
    runDir: string,
    meta: RunMeta,
  ) => Promise<boolean>;
  browser?: (args: string[]) => Promise<void>;
  run?: (args: string[]) => Promise<void>;
};

export function parseLaunchArgs(
  args: string[],
  options: { allowServe?: boolean; usage: string },
): LaunchRequest {
  let replace = false;
  let mode: "daemon" | "serve" = "daemon";
  for (const arg of args) {
    switch (arg) {
      case "--replace":
        replace = true;
        break;
      case "--serve":
        if (options.allowServe !== true) {
          throw new Error(`unknown arg ${arg}\n  usage: ${options.usage}`);
        }
        mode = "serve";
        break;
      default:
        throw new Error(`unknown arg ${arg}\n  usage: ${options.usage}`);
    }
  }
  return options.allowServe === true ? { replace, mode } : { replace };
}
