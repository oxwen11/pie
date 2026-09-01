import fs from "node:fs";
import path from "node:path";

import { isHelpFlag } from "../argv.ts";
import { DEFAULT_CDP_PORT, DESKTOP, userDataDir } from "../identity.ts";
import { stopRecordedDaemon } from "../lifecycle/daemon-stop.ts";
import { patchRunMeta, readRunMeta, type DesktopRunMeta, type RunMeta } from "../meta.ts";
import { agentBrowser, browserNeedsIsolation, forwardAgentBrowser } from "../runtime/browser.ts";
import { ensureServerBuilt, readDaemonRecord, redactDaemonRecord } from "../runtime/daemon.ts";
import { copySideEffects } from "../runtime/evidence.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun, isoNow, removePath, writeText } from "../runtime/fs.ts";
import { cdpOk, fetchText, healthOk, ticketStatus, urlPort } from "../runtime/http.ts";
import {
  commandOnPath,
  envPort,
  killTree,
  pidAlive,
  readPidFile,
  spawnLogged,
  waitDead,
  waitUntil,
  writePidFile,
} from "../runtime/process.ts";
import { parseLaunchArgs, type LaunchCtx, type SurfaceDefinition } from "../surface.ts";

const usageText = `Usage:
  pie-verify desktop launch [--replace]
  pie-verify desktop doctor
  pie-verify desktop browser snapshot|connect|<agent-browser argv…>
  pie-verify desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  pie-verify desktop cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;

function asDesktop(meta: RunMeta, where: string): DesktopRunMeta {
  if (meta.surface !== "desktop") {
    fail(`pie-verify desktop ${where}: FAIL — expected desktop meta`);
  }
  return meta;
}

function sessionName(): string {
  return DESKTOP.browserSession ?? "pie-verify-desktop";
}

export const desktopSurface: SurfaceDefinition = {
  identity: DESKTOP,
  usage: usageText,
  evidenceUsage: `Usage:
  pie-verify desktop evidence path
  pie-verify desktop evidence init
  pie-verify desktop evidence screenshot <name>
  pie-verify desktop evidence snapshot <name>
  pie-verify desktop evidence curl
  pie-verify desktop evidence side-effects
  pie-verify desktop evidence note <text>`,
  parseLaunch: (args) => parseLaunchArgs(args, { usage: `${DESKTOP.bin} launch [--replace]` }),
  ensureBuilt: (repo) => {
    ensureServerBuilt(repo);
  },
  preflight: () => {
    if (process.env.DISPLAY === undefined && commandOnPath("xvfb-run") === undefined) {
      throw new Error(
        "no DISPLAY and no xvfb-run. Refuse to start Electron headless without a display.",
      );
    }
  },
  portPlan: () => {
    const piePort = envPort("PIE_PORT", DESKTOP.defaultPiePort);
    const cdpPort = envPort("PIE_REMOTE_DEBUG_PORT", DEFAULT_CDP_PORT);
    return {
      piePort,
      cdpPort,
      refuseTaken: [cdpPort],
      warnTaken: [DESKTOP.defaultPiePort],
    };
  },
  isHealthy: async (runDir, meta) => {
    const desktop = asDesktop(meta, "launch");
    const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
    const recordPath = path.join(runDir, "pie-home/daemon/daemon.pid");
    if (!pidAlive(evPid) || !fs.existsSync(recordPath)) {
      return false;
    }
    const record = readDaemonRecord(recordPath);
    return (
      pidAlive(record.pid) && (await healthOk(record.address)) && (await cdpOk(desktop.cdpPort))
    );
  },
  livePids: (runDir) => {
    const pid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
    return pid === undefined ? [] : [pid];
  },
  initialMeta: (ctx) => {
    const cdpPort = ctx.cdpPort ?? DEFAULT_CDP_PORT;
    return {
      surface: "desktop",
      runId: ctx.runId,
      repo: ctx.repo,
      pieHome: ctx.pieHome,
      piePort: ctx.piePort,
      daemonDir: ctx.daemonDir ?? path.join(ctx.pieHome, "daemon"),
      cdpPort,
      userData: userDataDir(cdpPort),
      sampleProject: ctx.sample?.path ?? "",
      createdSample: ctx.sample?.created ?? false,
      startedAt: isoNow(),
    };
  },
  spawn: startDesktop,
  inspect: inspectDesktop,
  stop: stopDesktop,
  afterEvidenceInit: (dest, runDir, meta) => {
    void runDir;
    const desktop = asDesktop(meta, "evidence");
    const record = path.join(desktop.daemonDir, "daemon.pid");
    if (fs.existsSync(record)) {
      redactDaemonRecord(record, path.join(dest, "daemon.pid.redacted.json"));
    }
  },
  evidenceExtra: evidenceDesktop,
  browser: browserDesktop,
};

async function startDesktop(ctx: LaunchCtx): Promise<void> {
  const cdpPort = ctx.cdpPort ?? DEFAULT_CDP_PORT;
  const logPath = path.join(ctx.runDir, "logs/electron-vite.log");
  const child =
    process.env.DISPLAY === undefined
      ? spawnLogged("xvfb-run", ["-a", "pnpm", "exec", "electron-vite", "dev"], logPath, {
          cwd: path.join(ctx.repo, "apps/desktop"),
          env: ctx.env,
        })
      : spawnLogged("pnpm", ["exec", "electron-vite", "dev"], logPath, {
          cwd: path.join(ctx.repo, "apps/desktop"),
          env: ctx.env,
        });
  if (child.pid === undefined) {
    throw new Error("failed to spawn electron-vite");
  }
  writePidFile(path.join(ctx.runDir, "pids/electron-vite.pid"), child.pid);

  const daemonDir = ctx.daemonDir ?? path.join(ctx.pieHome, "daemon");
  const recordPath = path.join(daemonDir, "daemon.pid");
  await waitUntil("daemon.pid", () => fs.existsSync(recordPath), 90);
  const record = readDaemonRecord(recordPath);
  await waitUntil(`daemon health at ${record.address}`, () => healthOk(record.address), 40);
  await waitUntil(`CDP on ${cdpPort}`, () => cdpOk(cdpPort), 40);
  const bound = urlPort(record.address);
  patchRunMeta(path.join(ctx.runDir, "meta.json"), {
    address: record.address,
    daemonPid: record.pid,
    piePort: bound,
  });
  console.log(`${DESKTOP.logPrefix}: launched ${ctx.runId}`);
  console.log(`  api     ${record.address}/api/health`);
  console.log(`  port    ${bound} (first spawn prefers 4000; this is the bound address)`);
  console.log(`  cdp     ${DESKTOP.bin} browser connect`);
  console.log(`  pid     electron-vite ${child.pid} daemon ${record.pid}`);
  console.log(`  home    ${ctx.pieHome}`);
  if (ctx.sample !== undefined) {
    console.log(`  sample  ${ctx.sample.path}`);
  }
  console.log(`  logs    ${path.join(ctx.runDir, "logs")}`);
  console.log(`  doctor  ${DESKTOP.bin} doctor`);
  console.log(`  browser ${DESKTOP.bin} browser snapshot`);
}

async function inspectDesktop(runDir: string, meta: RunMeta): Promise<string[]> {
  const desktop = asDesktop(meta, "doctor");
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  if (!pidAlive(evPid)) {
    fail(`${DESKTOP.logPrefix} doctor: FAIL — electron-vite pid ${evPid} is not running`);
  }
  const recordPath = path.join(desktop.daemonDir, "daemon.pid");
  if (!fs.existsSync(recordPath)) {
    fail(
      `${DESKTOP.logPrefix} doctor: FAIL — missing ${recordPath} — Electron did not attach/spawn a daemon`,
    );
  }
  const record = readDaemonRecord(recordPath);
  if (!pidAlive(record.pid)) {
    fail(`${DESKTOP.logPrefix} doctor: FAIL — daemon pid ${record.pid} is not running`);
  }
  if (!(await healthOk(record.address))) {
    fail(`${DESKTOP.logPrefix} doctor: FAIL — ${record.address}/api/health is not ok`);
  }
  const anon = await ticketStatus(record.address);
  if (anon !== 401) {
    fail(
      `${DESKTOP.logPrefix} doctor: FAIL — /api/ws-ticket without token returned ${anon} (expected 401)`,
    );
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(
      `${DESKTOP.logPrefix} doctor: FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`,
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
      `${DESKTOP.logPrefix} doctor: FAIL — agent-browser could not attach to CDP ${desktop.cdpPort}: ${message}`,
    );
  }
  return [
    `  api     ${record.address}/api/health`,
    `  cdp     ${DESKTOP.bin} browser connect`,
    `  title   ${title || "(empty)"}`,
    `  url     ${url || "(empty)"}`,
    `  home    ${desktop.pieHome}`,
    `  evite   pid ${evPid}`,
    `  daemon  pid ${record.pid}`,
    "  ticket  anonymous 401 / bearer 200",
    `  next    ${DESKTOP.bin} browser snapshot`,
  ];
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

async function evidenceDesktop(
  command: string,
  rest: string[],
  dest: string,
  runDir: string,
  meta: RunMeta,
): Promise<boolean> {
  const desktop = asDesktop(meta, "evidence");
  const session = sessionName();
  switch (command) {
    case "screenshot": {
      const destPath = path.join(dest, `${rest[0] ?? "screen"}.png`);
      agentBrowser(["screenshot", destPath], { session, cdpPort: desktop.cdpPort });
      console.log(destPath);
      return true;
    }
    case "snapshot": {
      const destPath = path.join(dest, `${rest[0] ?? "snapshot"}.txt`);
      agentBrowser(["snapshot"], { session, cdpPort: desktop.cdpPort, outputPath: destPath });
      console.log(destPath);
      return true;
    }
    case "curl": {
      writeText(path.join(dest, "curl.txt"), await curlTranscript(runDir, desktop));
      console.log(path.join(dest, "curl.txt"));
      return true;
    }
    case "side-effects": {
      const side = path.join(dest, "side-effects");
      copySideEffects(desktop.pieHome, side, false);
      console.log(side);
      return true;
    }
    default:
      return false;
  }
}

async function curlTranscript(runDir: string, meta: DesktopRunMeta): Promise<string> {
  void runDir;
  const record = readDaemonRecord(path.join(meta.daemonDir, "daemon.pid"));
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  const title = agentBrowser(["get", "title"], {
    session: sessionName(),
    cdpPort: meta.cdpPort,
  }).trim();
  const url = agentBrowser(["get", "url"], {
    session: sessionName(),
    cdpPort: meta.cdpPort,
  }).trim();
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

async function browserDesktop(args: string[]): Promise<void> {
  const session = sessionName();
  const usage = `Usage:
  ${DESKTOP.bin} browser snapshot
  ${DESKTOP.bin} browser connect [port]
  ${DESKTOP.bin} browser install|skills|--version
  ${DESKTOP.bin} browser <agent-browser argv…>

Uses the agent-browser dependency of @getpie/verify with --session ${session}
and --cdp from the current run.
Do not open http://localhost:4190/ or http://localhost:5173/ and call that desktop.
`;
  if (isHelpFlag(args[0])) {
    process.stdout.write(usage);
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
  const meta = asDesktop(readRunMeta(path.join(runDir, "meta.json")), "browser");
  const forwarded =
    args[0] === "connect" && args.length === 1 ? ["connect", String(meta.cdpPort)] : args;
  forwardAgentBrowser(forwarded, { session, cdpPort: meta.cdpPort });
}
