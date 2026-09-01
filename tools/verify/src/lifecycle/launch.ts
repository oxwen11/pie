import fs from "node:fs";
import path from "node:path";

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
import { commandOnPath, findRepoRoot, pidAlive } from "../runtime/process.ts";
import { ensureSampleProject } from "../runtime/scaffold.ts";
import { parseLaunchArgs, type LaunchCtx, type Surface } from "../surface.ts";
import { cleanup } from "./cleanup.ts";
import { recordedPids } from "./pids.ts";
import { applyPortPlan, portPlan } from "./ports.ts";
import { classifyExisting } from "./reuse.ts";

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

  const ctx = buildCtx({
    identityId: identity.id,
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
  return classifyExisting({
    healthy: false,
    live: recordedPids(surface.identity, runDir).some((pid) => pidAlive(pid)),
  });
}

function buildCtx(input: {
  identityId: "web" | "cli" | "desktop";
  repo: string;
  runId: string;
  runDir: string;
  pieHome: string;
  daemonDir?: string;
  piePort: number;
  vitePort?: number;
  cdpPort?: number;
  request: LaunchCtx["request"];
  sample?: { path: string; created: boolean };
  env: NodeJS.ProcessEnv;
}): LaunchCtx {
  const base = {
    repo: input.repo,
    runId: input.runId,
    runDir: input.runDir,
    pieHome: input.pieHome,
    piePort: input.piePort,
    request: input.request,
    env: input.env,
  };
  switch (input.identityId) {
    case "web":
      if (input.vitePort === undefined || input.sample === undefined) {
        throw new Error("web launch is missing vitePort or sample");
      }
      return { ...base, surface: "web", vitePort: input.vitePort, sample: input.sample };
    case "cli":
      if (input.daemonDir === undefined) {
        throw new Error("cli launch is missing daemonDir");
      }
      return { ...base, surface: "cli", daemonDir: input.daemonDir };
    case "desktop":
      if (
        input.cdpPort === undefined ||
        input.daemonDir === undefined ||
        input.sample === undefined
      ) {
        throw new Error("desktop launch is missing cdpPort, daemonDir, or sample");
      }
      return {
        ...base,
        surface: "desktop",
        daemonDir: input.daemonDir,
        cdpPort: input.cdpPort,
        sample: input.sample,
      };
    default: {
      const exhaustive: never = input.identityId;
      void exhaustive;
      throw new Error("unknown surface");
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
