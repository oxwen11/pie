import fs from "node:fs";
import path from "node:path";

import { tryReadRunMeta, writeRunMeta } from "../meta.ts";
import type { RunMeta } from "../meta.ts";
import {
  copyFailureLogs,
  currentRun,
  ensureDir,
  newRunId,
  removePath,
  setCurrentRun,
  tailFile,
} from "../runtime/fs.ts";
import { findRepoRoot, pidAlive } from "../runtime/process.ts";
import { ensureSampleProject } from "../runtime/scaffold.ts";
import type { LaunchCtx, SurfaceDefinition } from "../surface.ts";
import { cleanup } from "./cleanup.ts";
import { applyPortPlan } from "./ports.ts";
import { classifyExisting } from "./reuse.ts";

export async function launch(surface: SurfaceDefinition, args: string[]): Promise<void> {
  const request = surface.parseLaunch(args);
  const { identity } = surface;
  const repo = findRepoRoot();
  surface.preflight?.();
  await surface.ensureBuilt(repo);

  const plan = surface.portPlan();
  const existing = currentRun(identity.currentLink);
  if (existing !== undefined) {
    const meta = tryReadRunMeta(path.join(existing, "meta.json"));
    const kind = await classifyRun(surface, existing, meta, request);
    switch (kind) {
      case "reuse":
        if (meta !== undefined) {
          printReuse(identity.bin, identity.logPrefix, existing, meta);
        }
        return;
      case "live":
        if (request.replace) {
          await cleanup(surface, []);
        } else {
          throw new Error(
            `a previous run still has live processes (${existing}).\n  run ${identity.bin} cleanup or re-launch with --replace`,
          );
        }
        break;
      case "stale":
        console.log(`${identity.logPrefix}: dropping stale run pointer ${existing}`);
        removePath(identity.currentLink);
        break;
      default: {
        const exhaustive: never = kind;
        void exhaustive;
        break;
      }
    }
  }

  applyPortPlan(identity, plan);

  const runId = newRunId();
  const runDir = path.join(identity.root, "runs", runId);
  const pieHome = path.join(runDir, "pie-home");
  const daemonDir = identity.usesDaemonDir ? path.join(pieHome, "daemon") : undefined;
  const sample =
    identity.sample === undefined
      ? undefined
      : ensureSampleProject({
          home: process.env.HOME ?? "",
          name: identity.sample.name,
          marker: identity.sample.marker,
          readme: identity.sample.readme,
          markerBody: identity.sample.markerBody,
          logPrefix: identity.logPrefix,
        });

  ensureDir(path.join(runDir, "pids"));
  ensureDir(path.join(runDir, "logs"));
  ensureDir(pieHome);
  if (daemonDir !== undefined) {
    ensureDir(daemonDir);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PIE_HOME: pieHome,
    PIE_PORT: String(plan.piePort),
    NODE_ENV: "development",
  };
  if (daemonDir !== undefined) {
    env.PIE_DAEMON_DIR = daemonDir;
  }
  if (plan.cdpPort !== undefined) {
    env.PIE_REMOTE_DEBUG_PORT = String(plan.cdpPort);
  }

  const ctx: LaunchCtx = {
    repo,
    runId,
    runDir,
    pieHome,
    daemonDir,
    piePort: plan.piePort,
    vitePort: plan.vitePort,
    cdpPort: plan.cdpPort,
    request,
    sample,
    env,
  };
  writeRunMeta(path.join(runDir, "meta.json"), surface.initialMeta(ctx));
  setCurrentRun(identity.currentLink, runDir);

  try {
    await surface.spawn(ctx);
  } catch (error) {
    tailFailure(runDir, pieHome);
    copyFailureLogs(runDir, path.join(identity.root, "last-failure"));
    await cleanup(surface, []).catch(() => undefined);
    throw error;
  }
}

async function classifyRun(
  surface: SurfaceDefinition,
  runDir: string,
  meta: RunMeta | undefined,
  request: ReturnType<SurfaceDefinition["parseLaunch"]>,
): Promise<"reuse" | "live" | "stale"> {
  const reusable =
    meta !== undefined &&
    meta.surface === surface.identity.id &&
    (surface.canReuse === undefined || surface.canReuse(meta, request));
  const healthy =
    reusable && meta !== undefined && (await surface.isHealthy(runDir, meta, request));
  const live = surface.livePids(runDir, meta).some((pid) => pidAlive(pid));
  return classifyExisting({ healthy, live });
}

function printReuse(bin: string, logPrefix: string, runDir: string, meta: RunMeta): void {
  console.log(`${logPrefix}: already running at ${runDir}`);
  switch (meta.surface) {
    case "web":
      console.log(`  app     ${meta.appUrl}`);
      console.log(`  api     http://127.0.0.1:${meta.piePort}/api/health`);
      console.log(`  home    ${meta.pieHome}`);
      return;
    case "cli":
      console.log(`  mode    ${meta.mode}`);
      console.log(`  api     ${meta.address ?? `http://127.0.0.1:${meta.piePort}`}/api/health`);
      if (meta.mode === "daemon") {
        console.log(`  home    ${meta.pieHome}`);
      }
      return;
    case "desktop":
      console.log(`  api     ${meta.address ?? `http://127.0.0.1:${meta.piePort}`}/api/health`);
      console.log(`  cdp     ${bin} browser connect`);
      console.log(`  home    ${meta.pieHome}`);
      return;
    default: {
      const exhaustive: never = meta;
      void exhaustive;
    }
  }
}

function tailFailure(runDir: string, pieHome: string): void {
  const logs = path.join(runDir, "logs");
  if (fs.existsSync(logs)) {
    for (const name of fs.readdirSync(logs)) {
      tailFile(path.join(logs, name));
    }
  }
  tailFile(path.join(pieHome, "logs/pie.log"));
}
