import fs from "node:fs";
import path from "node:path";

import { ensureCoreBuilt } from "../../runtime/daemon.ts";
import {
  copyFailureLogs,
  currentRun,
  ensureDir,
  isoNow,
  newRunId,
  readJsonField,
  readText,
  removePath,
  setCurrentRun,
  tailFile,
  writeJson,
} from "../../runtime/fs.ts";
import { healthOk } from "../../runtime/http.ts";
import {
  envPort,
  findRepoRoot,
  listenPids,
  pidAlive,
  readPidFile,
  spawnLogged,
  waitUntil,
  writePidFile,
} from "../../runtime/process.ts";
import { ensureSampleProject } from "../../runtime/scaffold.ts";
import { cleanup } from "./cleanup.ts";
import {
  BIN,
  CURRENT_LINK,
  DEFAULT_PIE_PORT,
  ROOT,
  SAMPLE_MARKER,
  SAMPLE_NAME,
  VITE_PORT,
} from "./config.ts";

export async function launch(args: string[]): Promise<void> {
  let replace = false;
  for (const arg of args) {
    switch (arg) {
      case "--replace":
        replace = true;
        break;
      default:
        throw new Error(`unknown arg ${arg}\n  usage: ${BIN} launch [--replace]`);
    }
  }

  const repo = findRepoRoot();
  const piePort = envPort("PIE_PORT", DEFAULT_PIE_PORT);
  if (piePort === 4000) {
    throw new Error("refuse PIE_PORT=4000 — that is the desktop daemon port (auth-token gated).");
  }
  ensureCoreBuilt(repo);

  const existing = currentRun(CURRENT_LINK);
  if (existing !== undefined) {
    const serverPid = readPidFile(path.join(existing, "pids/server.pid"));
    const vitePid = readPidFile(path.join(existing, "pids/vite.pid"));
    if (
      pidAlive(serverPid) &&
      pidAlive(vitePid) &&
      (await healthOk(piePort)) &&
      (await healthOk(VITE_PORT))
    ) {
      console.log(`verify-pie: already running at ${existing}`);
      console.log(`  app     http://localhost:${VITE_PORT}/`);
      console.log(`  api     http://127.0.0.1:${piePort}/api/health`);
      console.log(
        `  home    ${readJsonField<string>(path.join(existing, "meta.json"), "pieHome")}`,
      );
      return;
    }
    if (pidAlive(serverPid) || pidAlive(vitePid)) {
      if (replace) {
        await cleanup([]);
      } else {
        throw new Error(
          `a previous run still has live processes (${existing}).\n  run ${BIN} cleanup or re-launch with --replace`,
        );
      }
    } else {
      console.log(`verify-pie: dropping stale run pointer ${existing}`);
      removePath(CURRENT_LINK);
    }
  }

  refuseTakenPort(piePort);
  refuseTakenPort(VITE_PORT);

  const runId = newRunId();
  const runDir = path.join(ROOT, "runs", runId);
  const pieHome = path.join(runDir, "pie-home");
  const sample = ensureSampleProject({
    home: process.env.HOME ?? "",
    name: SAMPLE_NAME,
    marker: SAMPLE_MARKER,
    readme: "sample project for pie verification\n",
    markerBody:
      "verify-pie scaffolding — safe to delete. Created so the import-project dialog\nlists a distinctive folder at $HOME without walking a long path.\n",
    logPrefix: "verify-pie",
  });
  ensureDir(path.join(runDir, "pids"));
  ensureDir(path.join(runDir, "logs"));
  ensureDir(pieHome);

  writeJson(path.join(runDir, "meta.json"), {
    runId,
    repo,
    pieHome,
    piePort,
    vitePort: VITE_PORT,
    appUrl: `http://localhost:${VITE_PORT}/`,
    sampleProject: sample.path,
    createdSample: sample.created,
    startedAt: isoNow(),
  });
  setCurrentRun(CURRENT_LINK, runDir);

  const env = {
    ...process.env,
    PIE_PORT: String(piePort),
    PIE_HOME: pieHome,
    NODE_ENV: "development",
  };
  const server = spawnLogged("pnpm", ["dev"], path.join(runDir, "logs/server.log"), {
    cwd: path.join(repo, "packages/pie"),
    env,
  });
  if (server.pid === undefined) {
    throw new Error("failed to spawn pie serve");
  }
  writePidFile(path.join(runDir, "pids/server.pid"), server.pid);

  try {
    await waitUntil(`pie serve on ${piePort}`, () => healthOk(piePort), 60);
  } catch (error) {
    tailFile(path.join(runDir, "logs/server.log"));
    copyFailureLogs(runDir, path.join(ROOT, "last-failure"));
    await cleanup([]).catch(() => undefined);
    throw error;
  }

  const serverLog = path.join(runDir, "logs/server.log");
  if (fs.existsSync(serverLog) && !readText(serverLog).includes("pie:ready ")) {
    console.error("verify-pie: /api/health is ok but the ready line never appeared — continuing");
  }

  const vite = spawnLogged("pnpm", ["dev"], path.join(runDir, "logs/vite.log"), {
    cwd: path.join(repo, "apps/app"),
    env: { ...process.env, PIE_PORT: String(piePort) },
  });
  if (vite.pid === undefined) {
    throw new Error("failed to spawn vite");
  }
  writePidFile(path.join(runDir, "pids/vite.pid"), vite.pid);

  try {
    await waitUntil(`vite proxy on ${VITE_PORT}`, () => healthOk(VITE_PORT), 90);
  } catch (error) {
    tailFile(path.join(runDir, "logs/vite.log"));
    copyFailureLogs(runDir, path.join(ROOT, "last-failure"));
    await cleanup([]).catch(() => undefined);
    throw error;
  }

  await fetch(`http://localhost:${VITE_PORT}/`, { signal: AbortSignal.timeout(10_000) }).catch(
    () => undefined,
  );

  console.log(`verify-pie: launched ${runId}`);
  console.log(
    `  app     http://localhost:${VITE_PORT}/   (Vite binds [::1]; do not use 127.0.0.1:${VITE_PORT})`,
  );
  console.log(`  api     http://127.0.0.1:${piePort}/api/health`);
  console.log(`  home    ${pieHome}`);
  console.log(`  sample  ${sample.path}`);
  console.log(`  logs    ${path.join(runDir, "logs")}`);
  console.log(`  doctor  ${BIN} doctor`);
}

function refuseTakenPort(port: number): void {
  const pids = listenPids(port);
  if (pids.length > 0) {
    throw new Error(
      `port ${port} is already taken by pid(s): ${pids.join(" ")}\n  Vite is pinned to ${VITE_PORT} (strict). Two web instances cannot share it.\n  Do not drive a foreign pie / Vite — refuse rather than hijack.`,
    );
  }
}
