import type { SurfaceId, SurfaceIdentity } from "./identity.ts";
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

type LaunchBase = {
  repo: string;
  runId: string;
  runDir: string;
  pieHome: string;
  piePort: number;
  request: LaunchRequest;
  env: NodeJS.ProcessEnv;
};

export type LaunchCtx =
  | (LaunchBase & { surface: "web"; vitePort: number; sample: SampleProject })
  | (LaunchBase & { surface: "cli"; daemonDir: string })
  | (LaunchBase & {
      surface: "desktop";
      daemonDir: string;
      cdpPort: number;
      sample: SampleProject;
    });

export type ProbeOk = {
  pids: number[];
  lines: string[];
};

export type Surface = {
  identity: SurfaceIdentity;
  spawn: (ctx: LaunchCtx) => Promise<void>;
  probe: (runDir: string, meta: RunMeta) => Promise<ProbeOk>;
  stop: (runDir: string, meta: RunMeta | undefined) => Promise<void>;
};

export function expectLaunch<S extends SurfaceId>(
  ctx: LaunchCtx,
  surface: S,
): Extract<LaunchCtx, { surface: S }> {
  if (ctx.surface !== surface) {
    throw new TypeError(`expected ${surface} launch ctx, got ${ctx.surface}`);
  }
  return ctx as Extract<LaunchCtx, { surface: S }>;
}

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
