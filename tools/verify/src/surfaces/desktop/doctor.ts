import fs from "node:fs";
import path from "node:path";

import { agentBrowser } from "../../runtime/browser.ts";
import { readDaemonRecord } from "../../runtime/daemon.ts";
import { fail } from "../../runtime/fail.ts";
import { currentRun, readJsonField } from "../../runtime/fs.ts";
import { healthOk, ticketStatus } from "../../runtime/http.ts";
import { isSharedPieHome, listenPids, pidAlive, readPidFile } from "../../runtime/process.ts";
import { BIN, BROWSER_SESSION, CURRENT_LINK, DEFAULT_DAEMON_PORT } from "./config.ts";

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

  const meta = path.join(runDir, "meta.json");
  if (!fs.existsSync(meta)) {
    fail(`verify-pie-desktop doctor: FAIL — missing ${meta}`);
  }

  const pieHome = readJsonField<string>(meta, "pieHome");
  const daemonDir = readJsonField<string>(meta, "daemonDir");
  const cdpPort = readJsonField<number>(meta, "cdpPort");
  const runId = readJsonField<string>(meta, "runId");

  if (!fs.existsSync(pieHome)) {
    fail(`verify-pie-desktop doctor: FAIL — PIE_HOME ${pieHome} is missing`);
  }
  if (isSharedPieHome(pieHome)) {
    fail(
      `verify-pie-desktop doctor: FAIL — PIE_HOME is the shared default (${pieHome}). This skill only drives isolated homes.`,
    );
  }

  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  if (!pidAlive(evPid)) {
    fail(`verify-pie-desktop doctor: FAIL — electron-vite pid ${evPid} is not running`);
  }

  const recordPath = path.join(daemonDir, "daemon.pid");
  if (!fs.existsSync(recordPath)) {
    fail(
      `verify-pie-desktop doctor: FAIL — missing ${recordPath} — Electron did not attach/spawn a daemon`,
    );
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
    fail(
      `verify-pie-desktop doctor: FAIL — /api/ws-ticket without token returned ${anon} (expected 401)`,
    );
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(
      `verify-pie-desktop doctor: FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`,
    );
  }
  let title = "";
  let url = "";
  try {
    agentBrowser(["connect", String(cdpPort)], { session: BROWSER_SESSION });
    title = agentBrowser(["get", "title"], { session: BROWSER_SESSION }).trim();
    url = agentBrowser(["get", "url"], { session: BROWSER_SESSION }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `verify-pie-desktop doctor: FAIL — agent-browser could not attach to CDP ${cdpPort}: ${message}`,
    );
  }

  return [
    "verify-pie-desktop doctor: OK",
    `  run     ${runId}`,
    `  api     ${record.address}/api/health`,
    `  cdp     ${BIN} browser connect`,
    `  title   ${title || "(empty)"}`,
    `  url     ${url || "(empty)"}`,
    `  home    ${pieHome}`,
    `  evite   pid ${evPid}`,
    `  daemon  pid ${record.pid}`,
    "  ticket  anonymous 401 / bearer 200",
    `  next    ${BIN} browser snapshot`,
    "",
  ].join("\n");
}
