import fs from "node:fs";
import path from "node:path";

import { cleanup } from "./cleanup.ts";
import { BIN, CURRENT_LINK, DEFAULT_PIE_PORT, ROOT, refuseReservedPort } from "./config.ts";
import {
  ensureCoreBuilt,
  readDaemonRecord,
  resolveCompatKey,
  invokePie,
  spawnPie,
} from "./runtime/daemon.ts";
import {
  copyFailureLogs,
  currentRun,
  ensureDir,
  isoNow,
  newRunId,
  patchJson,
  readJsonField,
  readText,
  setCurrentRun,
  tailFile,
  writeJson,
} from "./runtime/fs.ts";
import { healthOk } from "./runtime/http.ts";
import {
  envPort,
  findRepoRoot,
  listenPids,
  pidAlive,
  readPidFile,
  waitUntil,
  writePidFile,
} from "./runtime/process.ts";

export async function launch(args: string[]): Promise<void> {
  let replace = false;
  let mode: "daemon" | "serve" = "daemon";
  for (const arg of args) {
    switch (arg) {
      case "--replace":
        replace = true;
        break;
      case "--serve":
        mode = "serve";
        break;
      default:
        throw new Error(`unknown arg ${arg}\n  usage: ${BIN} launch [--replace] [--serve]`);
    }
  }

  const repo = findRepoRoot();
  const piePort = envPort("PIE_PORT", DEFAULT_PIE_PORT);
  refuseReservedPort(piePort);
  ensureCoreBuilt(repo);

  const existing = currentRun(CURRENT_LINK);
  if (existing !== undefined) {
    if (await reuseIfHealthy(existing, mode, piePort)) {
      return;
    }
    if (replace) {
      await cleanup([]);
    } else {
      throw new Error(
        `a previous run still exists (${existing}).\n  run ${BIN} cleanup or re-launch with --replace`,
      );
    }
  }

  const foreign = listenPids(piePort);
  if (foreign.length > 0) {
    throw new Error(
      `port ${piePort} is already taken by pid(s): ${foreign.join(" ")}\n  Do not attach to a foreign daemon — refuse rather than hijack.`,
    );
  }

  const runId = newRunId();
  const runDir = path.join(ROOT, "runs", runId);
  const pieHome = path.join(runDir, "pie-home");
  const daemonDir = path.join(pieHome, "daemon");
  ensureDir(path.join(runDir, "pids"));
  ensureDir(path.join(runDir, "logs"));
  ensureDir(daemonDir);

  const env = {
    ...process.env,
    PIE_HOME: pieHome,
    PIE_DAEMON_DIR: daemonDir,
    PIE_PORT: String(piePort),
    NODE_ENV: "development",
    PIE_DAEMON_COMPATIBILITY_KEY: await resolveCompatKey(repo),
  };

  writeJson(path.join(runDir, "meta.json"), {
    runId,
    repo,
    mode,
    pieHome,
    daemonDir,
    piePort,
    startedAt: isoNow(),
  });
  setCurrentRun(CURRENT_LINK, runDir);

  try {
    if (mode === "serve") {
      await startServe(repo, runDir, piePort, env, runId, pieHome);
      return;
    }
    await startDaemon(repo, runDir, pieHome, daemonDir, env, runId);
  } catch (error) {
    copyFailureLogs(runDir, path.join(ROOT, "last-failure"));
    await cleanup([]).catch(() => undefined);
    throw error;
  }
}

async function reuseIfHealthy(
  runDir: string,
  mode: "daemon" | "serve",
  piePort: number,
): Promise<boolean> {
  const meta = path.join(runDir, "meta.json");
  if (!fs.existsSync(meta)) {
    return false;
  }
  if (readJsonField<string>(meta, "mode") !== mode) {
    return false;
  }
  if (mode === "serve") {
    const servePid = readPidFile(path.join(runDir, "pids/serve.pid"));
    if (pidAlive(servePid) && (await healthOk(piePort))) {
      console.log(`verify-pie-cli: already running at ${runDir}`);
      console.log("  mode    serve");
      console.log(`  api     http://127.0.0.1:${piePort}/api/health`);
      return true;
    }
    return false;
  }
  const recordPath = path.join(runDir, "pie-home/daemon/daemon.pid");
  if (!fs.existsSync(recordPath)) {
    return false;
  }
  const record = readDaemonRecord(recordPath);
  if (pidAlive(record.pid) && (await healthOk(record.address))) {
    console.log(`verify-pie-cli: already running at ${runDir}`);
    console.log("  mode    daemon");
    console.log(`  api     ${record.address}/api/health`);
    console.log(`  home    ${readJsonField<string>(meta, "pieHome")}`);
    return true;
  }
  return false;
}

async function startServe(
  repo: string,
  runDir: string,
  piePort: number,
  env: NodeJS.ProcessEnv,
  runId: string,
  pieHome: string,
): Promise<void> {
  const child = spawnPie(
    repo,
    ["serve", "--port", String(piePort)],
    path.join(runDir, "logs/serve.log"),
    env,
  );
  if (child.pid === undefined) {
    throw new Error("failed to spawn pie serve");
  }
  writePidFile(path.join(runDir, "pids/serve.pid"), child.pid);
  try {
    await waitUntil(`pie serve on ${piePort}`, () => healthOk(piePort), 60);
  } catch (error) {
    tailFile(path.join(runDir, "logs/serve.log"));
    throw error;
  }
  const address = `http://127.0.0.1:${piePort}`;
  patchJson(path.join(runDir, "meta.json"), { address });
  console.log(`verify-pie-cli: launched ${runId}`);
  console.log("  mode    serve (foreground, no token)");
  console.log(`  api     ${address}/api/health`);
  console.log(`  home    ${pieHome}`);
  console.log(`  logs    ${path.join(runDir, "logs")}`);
  console.log(`  doctor  ${BIN} doctor`);
}

async function startDaemon(
  repo: string,
  runDir: string,
  pieHome: string,
  daemonDir: string,
  env: NodeJS.ProcessEnv,
  runId: string,
): Promise<void> {
  const startLog = path.join(runDir, "logs/cli-start.log");
  const started = invokePie(repo, ["daemon", "start", "--port", env.PIE_PORT ?? ""], env, {
    logPath: startLog,
  });
  if (started.status !== 0) {
    tailFile(startLog);
    throw new Error("daemon start failed");
  }
  const recordPath = path.join(daemonDir, "daemon.pid");
  try {
    await waitUntil("daemon.pid", () => fs.existsSync(recordPath), 20);
  } catch (error) {
    tailFile(startLog);
    throw error;
  }
  const record = readDaemonRecord(recordPath);
  try {
    await waitUntil(`daemon health at ${record.address}`, () => healthOk(record.address), 40);
  } catch (error) {
    tailFile(startLog);
    tailFile(path.join(pieHome, "logs/pie.log"));
    throw error;
  }
  patchJson(path.join(runDir, "meta.json"), { address: record.address, daemonPid: record.pid });
  console.log(`verify-pie-cli: launched ${runId}`);
  console.log("  mode    daemon");
  console.log(`  api     ${record.address}/api/health`);
  console.log(`  pid     ${record.pid}`);
  console.log(`  home    ${pieHome}`);
  if (fs.existsSync(startLog)) {
    console.log(`  start   ${readText(startLog).replaceAll("\n", "")}`);
  }
  console.log(`  doctor  ${BIN} doctor`);
}
