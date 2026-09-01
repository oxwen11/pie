import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../../verify-runtime/src/fail.ts";
import { readDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { healthOk, ticketStatus, urlPort } from "../../verify-runtime/src/http.ts";
import { isSharedPieHome, listenPids, pidAlive, readPidFile } from "../../verify-runtime/src/process.ts";
import { BIN, CURRENT_LINK, DEFAULT_PIE_PORT } from "./config.ts";

export async function doctor(): Promise<void> {
  process.stdout.write(await doctorReport());
}

export async function doctorReport(): Promise<string> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    const foreign = listenPids(DEFAULT_PIE_PORT);
    if (foreign.length > 0) {
      fail(
        `verify-pie-cli doctor: FAIL — port ${DEFAULT_PIE_PORT} is live but this is not a verify-pie-cli run (no ${CURRENT_LINK}). Refuse to drive a shared ~/.pie instance.`,
      );
    }
    fail(`verify-pie-cli doctor: FAIL — no current run. Launch first: ${BIN} launch`);
  }

  const meta = join(runDir, "meta.json");
  if (!existsSync(meta)) {
    fail(`verify-pie-cli doctor: FAIL — missing ${meta}`);
  }

  const mode = readJsonField<string>(meta, "mode");
  const pieHome = readJsonField<string>(meta, "pieHome");
  const daemonDir = readJsonField<string>(meta, "daemonDir");
  const piePort = readJsonField<number>(meta, "piePort");
  const runId = readJsonField<string>(meta, "runId");

  if (!existsSync(pieHome)) {
    fail(`verify-pie-cli doctor: FAIL — PIE_HOME ${pieHome} is missing`);
  }
  if (isSharedPieHome(pieHome)) {
    fail(`verify-pie-cli doctor: FAIL — PIE_HOME is the shared default (${pieHome}). This skill only drives isolated homes.`);
  }

  if (mode === "serve") {
    const servePid = readPidFile(join(runDir, "pids/serve.pid"));
    if (!pidAlive(servePid)) {
      fail(`verify-pie-cli doctor: FAIL — serve pid ${servePid} is not running`);
    }
    const address = `http://127.0.0.1:${piePort}`;
    if (!(await healthOk(address))) {
      fail(`verify-pie-cli doctor: FAIL — ${address}/api/health is not ok`);
    }
    const status = await ticketStatus(address);
    if (status !== 200) {
      fail(`verify-pie-cli doctor: FAIL — serve /api/ws-ticket returned ${status} (expected 200, no token)`);
    }
    return [
      "verify-pie-cli doctor: OK",
      `  run     ${runId}`,
      "  mode    serve",
      `  api     ${address}/api/health`,
      `  home    ${pieHome}`,
      `  serve   pid ${servePid}`,
      "  ticket  /api/ws-ticket 200 (no token)",
      "",
    ].join("\n");
  }

  const recordPath = join(daemonDir, "daemon.pid");
  if (!existsSync(recordPath)) {
    fail(`verify-pie-cli doctor: FAIL — missing ${recordPath}`);
  }
  const record = readDaemonRecord(recordPath);
  if (!pidAlive(record.pid)) {
    fail(`verify-pie-cli doctor: FAIL — daemon pid ${record.pid} is not running`);
  }
  if (!(await healthOk(record.address))) {
    fail(`verify-pie-cli doctor: FAIL — ${record.address}/api/health is not ok`);
  }
  const anon = await ticketStatus(record.address);
  if (anon !== 401) {
    fail(
      `verify-pie-cli doctor: FAIL — /api/ws-ticket without token returned ${anon} (expected 401 — 200 means you hit pie serve)`,
    );
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(`verify-pie-cli doctor: FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`);
  }
  const port = urlPort(record.address);
  if (listenPids(port).length === 0) {
    fail(`verify-pie-cli doctor: FAIL — nothing listens on ${port} (from daemon.pid address)`);
  }

  return [
    "verify-pie-cli doctor: OK",
    `  run     ${runId}`,
    "  mode    daemon",
    `  api     ${record.address}/api/health`,
    `  home    ${pieHome}`,
    `  daemon  pid ${record.pid}`,
    "  ticket  anonymous 401 / bearer 200",
    "",
  ].join("\n");
}
