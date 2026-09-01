import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../../verify-runtime/src/fail.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { healthOk, ticketStatus } from "../../verify-runtime/src/http.ts";
import { isSharedPieHome, listenPids, pidAlive, portOwnedByAncestor, readPidFile } from "../../verify-runtime/src/process.ts";
import { BIN, CURRENT_LINK, DEFAULT_PIE_PORT, VITE_PORT } from "./config.ts";

export async function doctor(): Promise<void> {
  process.stdout.write(await doctorReport());
}

export async function doctorReport(): Promise<string> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    const piePids = listenPids(DEFAULT_PIE_PORT);
    const vitePids = listenPids(VITE_PORT);
    if (piePids.length > 0 || vitePids.length > 0) {
      fail(
        `verify-pie doctor: FAIL — ports ${DEFAULT_PIE_PORT}/${VITE_PORT} are live but this is not a verify-pie run (no ${CURRENT_LINK}). Refuse to drive a shared ~/.pie or ~/.pie-dev instance.`,
      );
    }
    fail(`verify-pie doctor: FAIL — no current run. Launch first: ${BIN} launch`);
  }

  const meta = join(runDir, "meta.json");
  if (!existsSync(meta)) {
    fail(`verify-pie doctor: FAIL — missing ${meta}`);
  }

  const piePort = readJsonField<number>(meta, "piePort");
  const vitePort = readJsonField<number>(meta, "vitePort");
  const pieHome = readJsonField<string>(meta, "pieHome");
  const appUrl = readJsonField<string>(meta, "appUrl");
  const runId = readJsonField<string>(meta, "runId");
  const serverPid = readPidFile(join(runDir, "pids/server.pid"));
  const vitePid = readPidFile(join(runDir, "pids/vite.pid"));

  if (!pidAlive(serverPid)) {
    fail(`verify-pie doctor: FAIL — server pid ${serverPid} is not running`);
  }
  if (!pidAlive(vitePid)) {
    fail(`verify-pie doctor: FAIL — vite pid ${vitePid} is not running`);
  }
  if (serverPid === undefined || !portOwnedByAncestor(piePort, serverPid)) {
    fail(
      `verify-pie doctor: FAIL — port ${piePort} is owned by pid(s) ${listenPids(piePort).join(" ")}, not our tree (expected ancestor ${serverPid})`,
    );
  }
  if (vitePid === undefined || !portOwnedByAncestor(vitePort, vitePid)) {
    fail(
      `verify-pie doctor: FAIL — port ${vitePort} is owned by pid(s) ${listenPids(vitePort).join(" ")}, not our tree (expected ancestor ${vitePid})`,
    );
  }
  if (!(await healthOk(piePort))) {
    fail(`verify-pie doctor: FAIL — http://127.0.0.1:${piePort}/api/health is not ok`);
  }
  if (!(await healthOk(vitePort))) {
    fail(`verify-pie doctor: FAIL — Vite proxy :${vitePort}/api/health is not ok — open the Vite URL, not the API port`);
  }
  if (!existsSync(pieHome)) {
    fail(`verify-pie doctor: FAIL — PIE_HOME ${pieHome} is missing`);
  }
  if (isSharedPieHome(pieHome)) {
    fail(`verify-pie doctor: FAIL — PIE_HOME is the shared default (${pieHome}). This skill only drives isolated homes.`);
  }

  const ticket = (await ticketStatus(`http://localhost:${vitePort}`)) ?? (await ticketStatus(`http://127.0.0.1:${vitePort}`));
  if (ticket !== 200) {
    fail(`verify-pie doctor: FAIL — /api/ws-ticket returned ${ticket} (401 means you hit the daemon on 4000, not this serve)`);
  }

  const major = Number(process.versions.node.split(".")[0]);
  const warn = major < 24 ? `\nverify-pie doctor: WARN — current shell Node is v${process.versions.node}; pie serve wants >= 24.\n` : "";

  return [
    "verify-pie doctor: OK",
    `  run     ${runId}`,
    `  app     ${appUrl}`,
    `  api     http://127.0.0.1:${piePort}/api/health`,
    `  home    ${pieHome}`,
    `  server  pid ${serverPid}`,
    `  vite    pid ${vitePid}`,
    `  node    v${process.versions.node}`,
    "  ticket  /api/ws-ticket 200",
    warn,
  ].join("\n");
}
