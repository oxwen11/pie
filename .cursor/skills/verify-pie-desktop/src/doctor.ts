import { existsSync } from "node:fs";
import { join } from "node:path";
import { readDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { fail } from "../../verify-runtime/src/fail.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { cdpOk, healthOk, ticketStatus } from "../../verify-runtime/src/http.ts";
import { isSharedPieHome, listenPids, pidAlive, readPidFile } from "../../verify-runtime/src/process.ts";
import { BIN, CURRENT_LINK, DEFAULT_DAEMON_PORT } from "./config.ts";

export async function doctor(): Promise<void> {
  process.stdout.write(await doctorReport());
}

export async function doctorReport(): Promise<string> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    if (listenPids(DEFAULT_DAEMON_PORT).length > 0) {
      fail(
        `verify-pie-desktop doctor: FAIL — port ${DEFAULT_DAEMON_PORT} is live but this is not a verify-pie-desktop run (no ${CURRENT_LINK}). Refuse to drive a shared daemon.`,
      );
    }
    fail(`verify-pie-desktop doctor: FAIL — no current run. Launch first: ${BIN} launch`);
  }

  const meta = join(runDir, "meta.json");
  if (!existsSync(meta)) {
    fail(`verify-pie-desktop doctor: FAIL — missing ${meta}`);
  }

  const pieHome = readJsonField<string>(meta, "pieHome");
  const daemonDir = readJsonField<string>(meta, "daemonDir");
  const cdpPort = readJsonField<number>(meta, "cdpPort");
  const runId = readJsonField<string>(meta, "runId");

  if (!existsSync(pieHome)) {
    fail(`verify-pie-desktop doctor: FAIL — PIE_HOME ${pieHome} is missing`);
  }
  if (isSharedPieHome(pieHome)) {
    fail(`verify-pie-desktop doctor: FAIL — PIE_HOME is the shared default (${pieHome}). This skill only drives isolated homes.`);
  }

  const evPid = readPidFile(join(runDir, "pids/electron-vite.pid"));
  if (!pidAlive(evPid)) {
    fail(`verify-pie-desktop doctor: FAIL — electron-vite pid ${evPid} is not running`);
  }

  const recordPath = join(daemonDir, "daemon.pid");
  if (!existsSync(recordPath)) {
    fail(`verify-pie-desktop doctor: FAIL — missing ${recordPath} — Electron did not attach/spawn a daemon`);
  }
  const record = readDaemonRecord(recordPath);
  if (!pidAlive(record.pid)) {
    fail(`verify-pie-desktop doctor: FAIL — daemon pid ${record.pid} is not running`);
  }
  if (!(await healthOk(record.address))) {
    fail(`verify-pie-desktop doctor: FAIL — ${record.address}/api/health is not ok`);
  }
  const anon = await ticketStatus(record.address);
  if (anon !== 401) {
    fail(`verify-pie-desktop doctor: FAIL — /api/ws-ticket without token returned ${anon} (expected 401)`);
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(`verify-pie-desktop doctor: FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`);
  }
  if (!(await cdpOk(cdpPort))) {
    fail(`verify-pie-desktop doctor: FAIL — CDP http://127.0.0.1:${cdpPort}/json/version is not answering`);
  }

  return [
    "verify-pie-desktop doctor: OK",
    `  run     ${runId}`,
    `  api     ${record.address}/api/health`,
    `  cdp     http://127.0.0.1:${cdpPort}/json/version`,
    `  home    ${pieHome}`,
    `  evite   pid ${evPid}`,
    `  daemon  pid ${record.pid}`,
    "  ticket  anonymous 401 / bearer 200",
    `  attach  agent-browser skills get electron  (CDP ${cdpPort})`,
    "",
  ].join("\n");
}
