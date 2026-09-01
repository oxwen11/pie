import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureServerBuilt, readDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { copyFailureLogs, currentRun, ensureDir, isoNow, newRunId, patchJson, readJsonField, removePath, setCurrentRun, tailFile, writeJson } from "../../verify-runtime/src/fs.ts";
import { cdpOk, healthOk, urlPort } from "../../verify-runtime/src/http.ts";
import { commandOnPath, envPort, findRepoRoot, listenPids, pidAlive, readPidFile, spawnLogged, waitUntil, writePidFile } from "../../verify-runtime/src/process.ts";
import { ensureSampleProject } from "../../verify-runtime/src/scaffold.ts";
import { cleanup } from "./cleanup.ts";
import { BIN, BROWSER_SESSION, CURRENT_LINK, DEFAULT_CDP_PORT, DEFAULT_DAEMON_PORT, ROOT, SAMPLE_MARKER, SAMPLE_NAME, refuseWebOrCliPort, userDataDir } from "./config.ts";

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
  const cdpPort = envPort("PIE_REMOTE_DEBUG_PORT", DEFAULT_CDP_PORT);
  if (process.env.PIE_PORT !== undefined && process.env.PIE_PORT !== "") {
    refuseWebOrCliPort(Number(process.env.PIE_PORT));
  }
  const piePort = envPort("PIE_PORT", DEFAULT_DAEMON_PORT);
  ensureServerBuilt(repo);

  if (process.env.DISPLAY === undefined && commandOnPath("xvfb-run") === undefined) {
    throw new Error("no DISPLAY and no xvfb-run. Refuse to start Electron headless without a display.");
  }

  const existing = currentRun(CURRENT_LINK);
  if (existing !== undefined) {
    if (await reuseIfHealthy(existing)) {
      return;
    }
    const evPid = readPidFile(join(existing, "pids/electron-vite.pid"));
    if (pidAlive(evPid)) {
      if (replace) {
        await cleanup([]);
      } else {
        throw new Error(`a previous run still has live processes (${existing}).\n  run ${BIN} cleanup or re-launch with --replace`);
      }
    } else {
      console.log(`verify-pie-desktop: dropping stale run pointer ${existing}`);
      removePath(CURRENT_LINK);
    }
  }

  if (listenPids(DEFAULT_DAEMON_PORT).length > 0) {
    console.error(
      `verify-pie-desktop: port ${DEFAULT_DAEMON_PORT} is taken; daemon will pick an ephemeral port (isolated PIE_HOME).`,
    );
  }
  const cdpPids = listenPids(cdpPort);
  if (cdpPids.length > 0) {
    throw new Error(
      `port ${cdpPort} (CDP) is already taken by pid(s): ${cdpPids.join(" ")}\n  Do not attach to a foreign desktop / daemon — refuse rather than hijack.`,
    );
  }

  const runId = newRunId();
  const runDir = join(ROOT, "runs", runId);
  const pieHome = join(runDir, "pie-home");
  const daemonDir = join(pieHome, "daemon");
  const userData = userDataDir(cdpPort);
  const sample = ensureSampleProject({
    home: process.env.HOME ?? "",
    name: SAMPLE_NAME,
    marker: SAMPLE_MARKER,
    readme: "sample project for pie desktop verification\n",
    markerBody: "verify-pie-desktop scaffolding — safe to delete.\n",
    logPrefix: "verify-pie-desktop",
  });
  ensureDir(join(runDir, "pids"));
  ensureDir(join(runDir, "logs"));
  ensureDir(daemonDir);

  const env = {
    ...process.env,
    PIE_HOME: pieHome,
    PIE_DAEMON_DIR: daemonDir,
    PIE_PORT: String(piePort),
    PIE_REMOTE_DEBUG_PORT: String(cdpPort),
    NODE_ENV: "development",
  };

  writeJson(join(runDir, "meta.json"), {
    runId,
    repo,
    pieHome,
    daemonDir,
    piePort,
    cdpPort,
    userData,
    sampleProject: sample.path,
    createdSample: sample.created,
    startedAt: isoNow(),
  });
  setCurrentRun(CURRENT_LINK, runDir);

  const logPath = join(runDir, "logs/electron-vite.log");
  const child =
    process.env.DISPLAY === undefined
      ? spawnLogged("xvfb-run", ["-a", "pnpm", "exec", "electron-vite", "dev"], logPath, {
          cwd: join(repo, "apps/desktop"),
          env,
        })
      : spawnLogged("pnpm", ["exec", "electron-vite", "dev"], logPath, {
          cwd: join(repo, "apps/desktop"),
          env,
        });
  if (child.pid === undefined) {
    throw new Error("failed to spawn electron-vite");
  }
  writePidFile(join(runDir, "pids/electron-vite.pid"), child.pid);

  const recordPath = join(daemonDir, "daemon.pid");
  try {
    await waitUntil("daemon.pid", () => existsSync(recordPath), 90);
    const record = readDaemonRecord(recordPath);
    await waitUntil(`daemon health at ${record.address}`, () => healthOk(record.address), 40);
    // Chromium's own ready signal — the same endpoint `agent-browser connect` uses.
    // Do not loop `connect` here: that mutates a session. Doctor attaches via agent-browser.
    await waitUntil(`CDP on ${cdpPort}`, () => cdpOk(cdpPort), 40);
    const bound = urlPort(record.address);
    patchJson(join(runDir, "meta.json"), {
      address: record.address,
      daemonPid: record.pid,
      piePort: bound,
    });
    console.log(`verify-pie-desktop: launched ${runId}`);
    console.log(`  api     ${record.address}/api/health`);
    console.log(`  port    ${bound} (first spawn prefers 4000; this is the bound address)`);
    console.log(`  cdp     agent-browser --session ${BROWSER_SESSION} connect ${cdpPort}`);
    console.log(`  pid     electron-vite ${child.pid} daemon ${record.pid}`);
    console.log(`  home    ${pieHome}`);
    console.log(`  sample  ${sample.path}`);
    console.log(`  logs    ${join(runDir, "logs")}`);
    console.log(`  doctor  ${BIN} doctor`);
  } catch (error) {
    tailFile(logPath, 80);
    tailFile(join(pieHome, "logs/pie.log"));
    copyFailureLogs(runDir, join(ROOT, "last-failure"));
    await cleanup([]).catch(() => undefined);
    throw error;
  }
}

async function reuseIfHealthy(runDir: string): Promise<boolean> {
  const evPid = readPidFile(join(runDir, "pids/electron-vite.pid"));
  const recordPath = join(runDir, "pie-home/daemon/daemon.pid");
  if (!pidAlive(evPid) || !existsSync(recordPath)) {
    return false;
  }
  const record = readDaemonRecord(recordPath);
  const cdpPort = readJsonField<number>(join(runDir, "meta.json"), "cdpPort");
  if (pidAlive(record.pid) && (await healthOk(record.address)) && (await cdpOk(cdpPort))) {
    console.log(`verify-pie-desktop: already running at ${runDir}`);
    console.log(`  api     ${record.address}/api/health`);
    console.log(`  cdp     http://127.0.0.1:${cdpPort}/json/version`);
    console.log(`  home    ${readJsonField<string>(join(runDir, "meta.json"), "pieHome")}`);
    return true;
  }
  return false;
}
