import fs from "node:fs";
import path from "node:path";

import type { SurfaceIdentity } from "../identity.ts";
import { initialMeta, tryReadRunMeta, writeRunMeta } from "../meta.ts";
import type { RunMeta } from "../meta.ts";
import { ensureCoreBuilt, ensureServerBuilt } from "../runtime/daemon.ts";
import {
  copyFailureLogs,
  currentRun,
  ensureDir,
  newRunId,
  removePath,
  setCurrentRun,
  tailFile,
} from "../runtime/fs.ts";
import { commandOnPath, envPort, findRepoRoot, pidAlive } from "../runtime/process.ts";
import { ensureSampleProject, type SampleProject } from "../runtime/scaffold.ts";
import { parseLaunchArgs, type LaunchCtx, type Surface } from "../surface.ts";
import { cleanup } from "./cleanup.ts";
import { recordedPids } from "./pids.ts";
import { applyPortPlan, portPlan } from "./ports.ts";

export async function launch(surface: Surface, args: string[]): Promise<void> {
  const { identity } = surface;
  const request = parseLaunchArgs(args, {
    allowServe: identity.allowServe,
    usage: identity.allowServe
      ? `${identity.bin} launch [--replace] [--serve]`
      : `${identity.bin} launch [--replace]`,
  });
  const repo = findRepoRoot();
  if (
    identity.needsDisplay &&
    process.env.DISPLAY === undefined &&
    commandOnPath("xvfb-run") === undefined
  ) {
    throw new Error(
      "no DISPLAY and no xvfb-run. Refuse to start Electron headless without a display.",
    );
  }
  switch (identity.build) {
    case "core":
      ensureCoreBuilt(repo);
      break;
    case "server":
      ensureServerBuilt(repo);
      break;
    default: {
      const exhaustive: never = identity.build;
      void exhaustive;
    }
  }

  const plan = portPlan(identity);
  const existing = currentRun(identity.currentLink);
  if (existing !== undefined) {
    const meta = tryReadRunMeta(path.join(existing, "meta.json"));
    const kind = await classifyRun(surface, existing, meta, request.mode);
    switch (kind) {
      case "reuse":
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

  ensureDir(path.join(runDir, "pids"));
  ensureDir(path.join(runDir, "logs"));
  ensureDir(pieHome);
  switch (identity.id) {
    case "cli":
    case "desktop":
      ensureDir(path.join(pieHome, "daemon"));
      break;
    case "web":
      break;
    default: {
      const exhaustive: never = identity;
      void exhaustive;
    }
  }

  const ctx = toLaunchCtx(identity, {
    repo,
    runId,
    runDir,
    pieHome,
    piePort: plan.piePort,
    request,
    env: {
      ...process.env,
      PIE_HOME: pieHome,
      PIE_PORT: String(plan.piePort),
      NODE_ENV: "development",
    },
  });
  writeRunMeta(path.join(runDir, "meta.json"), initialMeta(ctx));
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
  surface: Surface,
  runDir: string,
  meta: RunMeta | undefined,
  mode: "daemon" | "serve" | undefined,
): Promise<"reuse" | "live" | "stale"> {
  const reusable =
    meta !== undefined &&
    meta.surface === surface.identity.id &&
    (meta.surface !== "cli" || mode === undefined || meta.mode === mode);
  if (reusable && meta !== undefined) {
    try {
      const probe = await surface.probe(runDir, meta);
      console.log(`${surface.identity.logPrefix}: already running at ${runDir}`);
      for (const line of probe.lines) {
        if (line !== "") {
          console.log(line);
        }
      }
      return "reuse";
    } catch {
      // fall through to live/stale
    }
  }
  return recordedPids(surface.identity, runDir).some((pid) => pidAlive(pid)) ? "live" : "stale";
}

function toLaunchCtx(
  identity: SurfaceIdentity,
  base: {
    repo: string;
    runId: string;
    runDir: string;
    pieHome: string;
    piePort: number;
    request: LaunchCtx["request"];
    env: NodeJS.ProcessEnv;
  },
): LaunchCtx {
  switch (identity.id) {
    case "web":
      return {
        ...base,
        surface: "web",
        vitePort: identity.vitePort,
        sample: scaffold(identity),
      };
    case "cli": {
      const daemonDir = path.join(base.pieHome, "daemon");
      return {
        ...base,
        surface: "cli",
        daemonDir,
        env: { ...base.env, PIE_DAEMON_DIR: daemonDir },
      };
    }
    case "desktop": {
      const daemonDir = path.join(base.pieHome, "daemon");
      const cdpPort = envPort("PIE_REMOTE_DEBUG_PORT", identity.cdpDefault);
      return {
        ...base,
        surface: "desktop",
        daemonDir,
        cdpPort,
        sample: scaffold(identity),
        env: {
          ...base.env,
          PIE_DAEMON_DIR: daemonDir,
          PIE_REMOTE_DEBUG_PORT: String(cdpPort),
        },
      };
    }
    default: {
      const exhaustive: never = identity;
      void exhaustive;
      throw new Error("unknown surface");
    }
  }
}

function scaffold(identity: Extract<SurfaceIdentity, { sample: unknown }>): SampleProject {
  return ensureSampleProject({
    home: process.env.HOME ?? "",
    name: identity.sample.name,
    marker: identity.sample.marker,
    readme: identity.sample.readme,
    markerBody: identity.sample.markerBody,
    logPrefix: identity.logPrefix,
  });
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
