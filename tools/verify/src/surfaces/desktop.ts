import fs from "node:fs";
import path from "node:path";

import { isHelpFlag } from "../argv.ts";
import { DESKTOP } from "../identity.ts";
import {
  expectMeta,
  patchRunMeta,
  readRunMeta,
  type DesktopRunMeta,
  type RunMeta,
} from "../meta.ts";
import {
  agentBrowser,
  browserNeedsIsolation,
  forwardAgentBrowser,
  saveScreenshot,
  saveSnapshot,
} from "../runtime/browser.ts";
import { readDaemonRecord, stopRecordedDaemon } from "../runtime/daemon.ts";
import { copySideEffects } from "../runtime/evidence.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun, removePath, writeText } from "../runtime/fs.ts";
import { cdpOk, fetchText, healthOk, ticketStatus, urlPort } from "../runtime/http.ts";
import {
  killTree,
  pidAlive,
  readPidFile,
  spawnLogged,
  waitDead,
  waitUntil,
  writePidFile,
} from "../runtime/process.ts";
import { expectLaunch, type LaunchCtx, type ProbeOk, type Surface } from "../surface.ts";

function sessionName(): string {
  return DESKTOP.browserSession;
}

export const desktopSurface: Surface = {
  identity: DESKTOP,
  spawn: startDesktop,
  probe: inspectDesktop,
  stop: stopDesktop,
};

async function startDesktop(ctx: LaunchCtx): Promise<void> {
  const desktop = expectLaunch(ctx, "desktop");
  const logPath = path.join(desktop.runDir, "logs/electron-vite.log");
  const viteArgs = ["exec", "electron-vite", "dev"];
  const child =
    process.env.DISPLAY === undefined
      ? spawnLogged("xvfb-run", ["-a", "pnpm", ...viteArgs], logPath, {
          cwd: path.join(desktop.repo, "apps/desktop"),
          env: desktop.env,
        })
      : spawnLogged("pnpm", viteArgs, logPath, {
          cwd: path.join(desktop.repo, "apps/desktop"),
          env: desktop.env,
        });
  if (child.pid === undefined) {
    throw new Error("failed to spawn electron-vite");
  }
  writePidFile(path.join(desktop.runDir, "pids/electron-vite.pid"), child.pid);

  const recordPath = path.join(desktop.daemonDir, "daemon.pid");
  await waitUntil("daemon.pid", () => fs.existsSync(recordPath), 90);
  const record = readDaemonRecord(recordPath);
  await waitUntil(`daemon health at ${record.address}`, () => healthOk(record.address), 40);
  await waitUntil(`CDP on ${desktop.cdpPort}`, () => cdpOk(desktop.cdpPort), 40);
  const bound = urlPort(record.address);
  patchRunMeta(path.join(desktop.runDir, "meta.json"), "desktop", {
    address: record.address,
    daemonPid: record.pid,
    piePort: bound,
  });
  console.log(`${DESKTOP.logPrefix}: launched ${desktop.runId}`);
  console.log(`  api     ${record.address}/api/health`);
  console.log(`  port    ${bound} (first spawn prefers 4000; this is the bound address)`);
  console.log(`  cdp     ${DESKTOP.bin} browser connect`);
  console.log(`  pid     electron-vite ${child.pid} daemon ${record.pid}`);
  console.log(`  home    ${desktop.pieHome}`);
  console.log(`  sample  ${desktop.sample.path}`);
  console.log(`  logs    ${path.join(desktop.runDir, "logs")}`);
  console.log(`  doctor  ${DESKTOP.bin} doctor`);
  console.log(`  browser ${DESKTOP.bin} browser snapshot`);
}

async function inspectDesktop(runDir: string, meta: RunMeta): Promise<ProbeOk> {
  const desktop = expectMeta(meta, "desktop");
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  if (!pidAlive(evPid)) {
    fail(`${DESKTOP.logPrefix} FAIL — electron-vite pid ${evPid} is not running`);
  }
  const recordPath = path.join(desktop.daemonDir, "daemon.pid");
  if (!fs.existsSync(recordPath)) {
    fail(
      `${DESKTOP.logPrefix} FAIL — missing ${recordPath} — Electron did not attach/spawn a daemon`,
    );
  }
  const record = readDaemonRecord(recordPath);
  if (!pidAlive(record.pid)) {
    fail(`${DESKTOP.logPrefix} FAIL — daemon pid ${record.pid} is not running`);
  }
  if (!(await healthOk(record.address))) {
    fail(`${DESKTOP.logPrefix} FAIL — ${record.address}/api/health is not ok`);
  }
  const anon = await ticketStatus(record.address);
  if (anon !== 401) {
    fail(
      `${DESKTOP.logPrefix} FAIL — /api/ws-ticket without token returned ${anon} (expected 401)`,
    );
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(
      `${DESKTOP.logPrefix} FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`,
    );
  }
  let title = "";
  let url = "";
  const session = sessionName();
  try {
    agentBrowser(["connect", String(desktop.cdpPort)], { session });
    title = agentBrowser(["get", "title"], { session }).trim();
    url = agentBrowser(["get", "url"], { session }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `${DESKTOP.logPrefix} FAIL — agent-browser could not attach to CDP ${desktop.cdpPort}: ${message}`,
    );
  }
  return {
    pids: evPid === undefined ? [record.pid] : [evPid, record.pid],
    lines: [
      `  api     ${record.address}/api/health`,
      `  cdp     ${DESKTOP.bin} browser connect`,
      `  title   ${title || "(empty)"}`,
      `  url     ${url || "(empty)"}`,
      `  home    ${desktop.pieHome}`,
      `  evite   pid ${evPid}`,
      `  daemon  pid ${record.pid}`,
      "  ticket  anonymous 401 / bearer 200",
      `  next    ${DESKTOP.bin} browser snapshot`,
    ],
  };
}

async function stopDesktop(runDir: string, meta: RunMeta | undefined): Promise<void> {
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  console.log(`${DESKTOP.logPrefix}: stopping electron-vite pid=${evPid ?? "none"}`);
  killTree(evPid);
  await waitDead(evPid);
  if (meta?.surface === "desktop") {
    await stopRecordedDaemon({
      repo: meta.repo,
      pieHome: meta.pieHome,
      daemonDir: meta.daemonDir,
      piePort: meta.piePort,
      runDir,
      logPrefix: DESKTOP.logPrefix,
    });
    if (meta.userData.includes("/pie-desktop-remote-debugging-")) {
      removePath(meta.userData);
      console.log(`${DESKTOP.logPrefix}: removed ${meta.userData}`);
    }
  }
}

export async function extraEvidence(
  command: string,
  rest: string[],
  dest: string,
  typed: DesktopRunMeta,
): Promise<boolean> {
  const session = sessionName();
  const target = { session, cdpPort: typed.cdpPort };
  switch (command) {
    case "screenshot":
      console.log(saveScreenshot(dest, rest[0] ?? "screen", target));
      return true;
    case "snapshot":
      console.log(saveSnapshot(dest, rest[0] ?? "snapshot", target));
      return true;
    case "curl":
      writeText(path.join(dest, "curl.txt"), await curlTranscript(typed));
      console.log(path.join(dest, "curl.txt"));
      return true;
    case "side-effects": {
      const side = path.join(dest, "side-effects");
      copySideEffects(typed.pieHome, side, false);
      console.log(side);
      return true;
    }
    default:
      return false;
  }
}

async function curlTranscript(meta: DesktopRunMeta): Promise<string> {
  const record = readDaemonRecord(path.join(meta.daemonDir, "daemon.pid"));
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  const session = sessionName();
  const title = agentBrowser(["get", "title"], { session, cdpPort: meta.cdpPort }).trim();
  const url = agentBrowser(["get", "url"], { session, cdpPort: meta.cdpPort }).trim();
  return [
    `GET ${record.address}/api/health`,
    health?.body ?? "",
    "",
    `POST ${record.address}/api/ws-ticket (no token)`,
    `status ${anon ?? "error"}`,
    `POST ${record.address}/api/ws-ticket (bearer)`,
    `status ${auth ?? "error"}`,
    `${DESKTOP.bin} browser get title`,
    title,
    `${DESKTOP.bin} browser get url`,
    url,
    "",
  ].join("\n");
}

export async function browserDesktop(args: string[]): Promise<void> {
  const session = sessionName();
  const usageText = `Usage:
  ${DESKTOP.bin} browser snapshot
  ${DESKTOP.bin} browser connect [port]
  ${DESKTOP.bin} browser install|skills|--version
  ${DESKTOP.bin} browser <agent-browser argv…>

Uses the mise-managed agent-browser with --session ${session}
and --cdp from the current run.
Do not open http://localhost:4190/ or http://localhost:5173/ and call that desktop.
`;
  if (isHelpFlag(args[0])) {
    process.stdout.write(usageText);
    return;
  }
  if (!browserNeedsIsolation(args[0])) {
    forwardAgentBrowser(args, {});
    return;
  }
  const runDir = currentRun(DESKTOP.currentLink);
  if (runDir === undefined) {
    throw new Error(`no current run. Launch first: ${DESKTOP.bin} launch`);
  }
  const meta = expectMeta(readRunMeta(path.join(runDir, "meta.json")), "desktop");
  const forwarded =
    args[0] === "connect" && args.length === 1 ? ["connect", String(meta.cdpPort)] : args;
  forwardAgentBrowser(forwarded, { session, cdpPort: meta.cdpPort });
}
