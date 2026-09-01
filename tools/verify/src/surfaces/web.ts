import fs from "node:fs";
import path from "node:path";

import { isHelpFlag } from "../argv.ts";
import { WEB, VITE_PORT } from "../identity.ts";
import type { RunMeta, WebRunMeta } from "../meta.ts";
import { agentBrowser, browserNeedsIsolation, forwardAgentBrowser } from "../runtime/browser.ts";
import { ensureCoreBuilt } from "../runtime/daemon.ts";
import { copySideEffects } from "../runtime/evidence.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun, isoNow, readText } from "../runtime/fs.ts";
import { healthOk, ticketStatusOnPort, warmupOrigin } from "../runtime/http.ts";
import {
  envPort,
  killTree,
  listenPids,
  pidAlive,
  portOwnedByAncestor,
  readPidFile,
  spawnLogged,
  waitDead,
  waitUntil,
  writePidFile,
} from "../runtime/process.ts";
import { parseLaunchArgs, type LaunchCtx, type SurfaceDefinition } from "../surface.ts";

const usageText = `Usage:
  pie-verify web launch [--replace]
  pie-verify web doctor
  pie-verify web browser open|snapshot|<agent-browser argv…>
  pie-verify web evidence path|init|screenshot|snapshot|url|side-effects|note
  pie-verify web cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;

function asWeb(meta: RunMeta, where: string): WebRunMeta {
  if (meta.surface !== "web") {
    fail(`pie-verify web ${where}: FAIL — expected web meta`);
  }
  return meta;
}

export const webSurface: SurfaceDefinition = {
  identity: WEB,
  usage: usageText,
  evidenceUsage: `Usage:
  pie-verify web evidence path
  pie-verify web evidence init
  pie-verify web evidence screenshot <name>
  pie-verify web evidence snapshot <name>
  pie-verify web evidence url
  pie-verify web evidence side-effects
  pie-verify web evidence note <text>`,
  parseLaunch: (args) => parseLaunchArgs(args, { usage: `${WEB.bin} launch [--replace]` }),
  ensureBuilt: (repo) => {
    ensureCoreBuilt(repo);
  },
  portPlan: () => {
    const piePort = envPort("PIE_PORT", WEB.defaultPiePort);
    return { piePort, vitePort: VITE_PORT, refuseTaken: [piePort, VITE_PORT], warnTaken: [] };
  },
  isHealthy: async (runDir, meta) => {
    const web = asWeb(meta, "launch");
    const serverPid = readPidFile(path.join(runDir, "pids/server.pid"));
    const vitePid = readPidFile(path.join(runDir, "pids/vite.pid"));
    return (
      pidAlive(serverPid) &&
      pidAlive(vitePid) &&
      (await healthOk(web.piePort)) &&
      (await healthOk(web.vitePort))
    );
  },
  livePids: (runDir) =>
    [
      readPidFile(path.join(runDir, "pids/server.pid")),
      readPidFile(path.join(runDir, "pids/vite.pid")),
    ].filter((pid): pid is number => pid !== undefined),
  initialMeta: (ctx) => ({
    surface: "web",
    runId: ctx.runId,
    repo: ctx.repo,
    pieHome: ctx.pieHome,
    piePort: ctx.piePort,
    vitePort: ctx.vitePort ?? VITE_PORT,
    appUrl: `http://localhost:${ctx.vitePort ?? VITE_PORT}/`,
    sampleProject: ctx.sample?.path ?? "",
    createdSample: ctx.sample?.created ?? false,
    startedAt: isoNow(),
  }),
  spawn: startWeb,
  inspect: inspectWeb,
  stop: stopWeb,
  evidenceExtra: evidenceWeb,
  browser: browserWeb,
};

async function startWeb(ctx: LaunchCtx): Promise<void> {
  const vitePort = ctx.vitePort ?? VITE_PORT;
  const server = spawnLogged("pnpm", ["dev"], path.join(ctx.runDir, "logs/server.log"), {
    cwd: path.join(ctx.repo, "packages/pie"),
    env: ctx.env,
  });
  if (server.pid === undefined) {
    throw new Error("failed to spawn pie serve");
  }
  writePidFile(path.join(ctx.runDir, "pids/server.pid"), server.pid);

  await waitUntil(`pie serve on ${ctx.piePort}`, () => healthOk(ctx.piePort), 60);

  const serverLog = path.join(ctx.runDir, "logs/server.log");
  if (fs.existsSync(serverLog) && !readText(serverLog).includes("pie:ready ")) {
    console.error(
      `${WEB.logPrefix}: /api/health is ok but the ready line never appeared — continuing`,
    );
  }

  const vite = spawnLogged("pnpm", ["dev"], path.join(ctx.runDir, "logs/vite.log"), {
    cwd: path.join(ctx.repo, "apps/app"),
    env: { ...process.env, PIE_PORT: String(ctx.piePort) },
  });
  if (vite.pid === undefined) {
    throw new Error("failed to spawn vite");
  }
  writePidFile(path.join(ctx.runDir, "pids/vite.pid"), vite.pid);
  await waitUntil(`vite proxy on ${vitePort}`, () => healthOk(vitePort), 90);
  await warmupOrigin(vitePort);

  console.log(`${WEB.logPrefix}: launched ${ctx.runId}`);
  console.log(
    `  app     http://localhost:${vitePort}/   (Vite binds [::1]; do not use 127.0.0.1:${vitePort})`,
  );
  console.log(`  api     http://127.0.0.1:${ctx.piePort}/api/health`);
  console.log(`  home    ${ctx.pieHome}`);
  if (ctx.sample !== undefined) {
    console.log(`  sample  ${ctx.sample.path}`);
  }
  console.log(`  logs    ${path.join(ctx.runDir, "logs")}`);
  console.log(`  doctor  ${WEB.bin} doctor`);
  console.log(`  browser ${WEB.bin} browser open`);
}

async function inspectWeb(runDir: string, meta: RunMeta): Promise<string[]> {
  const web = asWeb(meta, "doctor");
  const serverPid = readPidFile(path.join(runDir, "pids/server.pid"));
  const vitePid = readPidFile(path.join(runDir, "pids/vite.pid"));
  if (!pidAlive(serverPid)) {
    fail(`${WEB.logPrefix} doctor: FAIL — server pid ${serverPid} is not running`);
  }
  if (!pidAlive(vitePid)) {
    fail(`${WEB.logPrefix} doctor: FAIL — vite pid ${vitePid} is not running`);
  }
  if (serverPid === undefined || !portOwnedByAncestor(web.piePort, serverPid)) {
    fail(
      `${WEB.logPrefix} doctor: FAIL — port ${web.piePort} is owned by pid(s) ${listenPids(web.piePort).join(" ")}, not our tree (expected ancestor ${serverPid})`,
    );
  }
  if (vitePid === undefined || !portOwnedByAncestor(web.vitePort, vitePid)) {
    fail(
      `${WEB.logPrefix} doctor: FAIL — port ${web.vitePort} is owned by pid(s) ${listenPids(web.vitePort).join(" ")}, not our tree (expected ancestor ${vitePid})`,
    );
  }
  if (!(await healthOk(web.piePort))) {
    fail(`${WEB.logPrefix} doctor: FAIL — http://127.0.0.1:${web.piePort}/api/health is not ok`);
  }
  if (!(await healthOk(web.vitePort))) {
    fail(
      `${WEB.logPrefix} doctor: FAIL — Vite proxy :${web.vitePort}/api/health is not ok — open the Vite URL, not the API port`,
    );
  }
  const ticket = await ticketStatusOnPort(web.vitePort);
  if (ticket !== 200) {
    fail(
      `${WEB.logPrefix} doctor: FAIL — /api/ws-ticket returned ${ticket} (401 means you hit the daemon on 4000, not this serve)`,
    );
  }
  const major = Number(process.versions.node.split(".")[0]);
  const warn =
    major < 24
      ? `\n${WEB.logPrefix} doctor: WARN — current shell Node is v${process.versions.node}; pie serve wants >= 24.`
      : "";
  return [
    `  app     ${web.appUrl}`,
    `  api     http://127.0.0.1:${web.piePort}/api/health`,
    `  home    ${web.pieHome}`,
    `  server  pid ${serverPid}`,
    `  vite    pid ${vitePid}`,
    `  node    v${process.versions.node}`,
    "  ticket  /api/ws-ticket 200",
    warn,
  ];
}

async function stopWeb(runDir: string): Promise<void> {
  const serverPid = readPidFile(path.join(runDir, "pids/server.pid"));
  const vitePid = readPidFile(path.join(runDir, "pids/vite.pid"));
  console.log(
    `${WEB.logPrefix}: stopping server pid=${serverPid ?? "none"} vite pid=${vitePid ?? "none"}`,
  );
  killTree(vitePid);
  killTree(serverPid);
  await waitDead(vitePid);
  await waitDead(serverPid);
}

async function evidenceWeb(
  command: string,
  rest: string[],
  dest: string,
  runDir: string,
  meta: RunMeta,
): Promise<boolean> {
  void runDir;
  const session = WEB.browserSession ?? "pie-verify-web";
  switch (command) {
    case "screenshot": {
      const destPath = path.join(dest, `${rest[0] ?? "screen"}.png`);
      agentBrowser(["screenshot", destPath], { session });
      console.log(destPath);
      return true;
    }
    case "snapshot": {
      const destPath = path.join(dest, `${rest[0] ?? "snapshot"}.txt`);
      agentBrowser(["snapshot"], { session, outputPath: destPath });
      console.log(destPath);
      return true;
    }
    case "url": {
      const text = agentBrowser(["get", "url"], {
        session,
        outputPath: path.join(dest, "url.txt"),
      });
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      return true;
    }
    case "side-effects": {
      const side = path.join(dest, "side-effects");
      copySideEffects(asWeb(meta, "evidence").pieHome, side, true);
      console.log(side);
      return true;
    }
    default:
      return false;
  }
}

async function browserWeb(args: string[]): Promise<void> {
  const session = WEB.browserSession ?? "pie-verify-web";
  const usage = `Usage:
  ${WEB.bin} browser open [url]
  ${WEB.bin} browser snapshot
  ${WEB.bin} browser install|skills|--version
  ${WEB.bin} browser <agent-browser argv…>

Uses the agent-browser dependency of @getpie/verify with --session ${session}.
\`open\` with no URL uses http://localhost:${VITE_PORT}/.
`;
  if (isHelpFlag(args[0])) {
    process.stdout.write(usage);
    return;
  }
  if (browserNeedsIsolation(args[0]) && currentRun(WEB.currentLink) === undefined) {
    throw new Error(`no current run. Launch first: ${WEB.bin} launch`);
  }
  forwardAgentBrowser(args, {
    session,
    defaultOpenUrl: `http://localhost:${VITE_PORT}/`,
  });
}
