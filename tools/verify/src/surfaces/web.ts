import fs from "node:fs";
import path from "node:path";

import { isHelpFlag } from "../argv.ts";
import { VITE_PORT, WEB } from "../identity.ts";
import { expectMeta, type RunMeta, type WebRunMeta } from "../meta.ts";
import {
  agentBrowser,
  browserNeedsIsolation,
  forwardAgentBrowser,
  saveScreenshot,
  saveSnapshot,
} from "../runtime/browser.ts";
import { copySideEffects } from "../runtime/evidence.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun, readText } from "../runtime/fs.ts";
import { healthOk, ticketStatusOnPort, warmupOrigin } from "../runtime/http.ts";
import {
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
import { expectLaunch, type LaunchCtx, type ProbeOk, type Surface } from "../surface.ts";

function sessionName(): string {
  return WEB.browserSession ?? "pie-verify-web";
}

export const webSurface: Surface = {
  identity: WEB,
  spawn: startWeb,
  probe: inspectWeb,
  stop: stopWeb,
};

async function startWeb(ctx: LaunchCtx): Promise<void> {
  const web = expectLaunch(ctx, "web");
  const server = spawnLogged("pnpm", ["dev"], path.join(web.runDir, "logs/server.log"), {
    cwd: path.join(web.repo, "packages/pie"),
    env: web.env,
  });
  if (server.pid === undefined) {
    throw new Error("failed to spawn pie serve");
  }
  writePidFile(path.join(web.runDir, "pids/server.pid"), server.pid);
  await waitUntil(`pie serve on ${web.piePort}`, () => healthOk(web.piePort), 60);

  const serverLog = path.join(web.runDir, "logs/server.log");
  if (fs.existsSync(serverLog) && !readText(serverLog).includes("pie:ready ")) {
    console.error(
      `${WEB.logPrefix}: /api/health is ok but the ready line never appeared — continuing`,
    );
  }

  const vite = spawnLogged("pnpm", ["dev"], path.join(web.runDir, "logs/vite.log"), {
    cwd: path.join(web.repo, "apps/app"),
    env: { ...process.env, PIE_PORT: String(web.piePort) },
  });
  if (vite.pid === undefined) {
    throw new Error("failed to spawn vite");
  }
  writePidFile(path.join(web.runDir, "pids/vite.pid"), vite.pid);
  await waitUntil(`vite proxy on ${web.vitePort}`, () => healthOk(web.vitePort), 90);
  await warmupOrigin(web.vitePort);

  console.log(`${WEB.logPrefix}: launched ${web.runId}`);
  console.log(
    `  app     http://localhost:${web.vitePort}/   (Vite binds [::1]; do not use 127.0.0.1:${web.vitePort})`,
  );
  console.log(`  api     http://127.0.0.1:${web.piePort}/api/health`);
  console.log(`  home    ${web.pieHome}`);
  console.log(`  sample  ${web.sample.path}`);
  console.log(`  logs    ${path.join(web.runDir, "logs")}`);
  console.log(`  doctor  ${WEB.bin} doctor`);
  console.log(`  browser ${WEB.bin} browser open`);
}

async function inspectWeb(runDir: string, meta: RunMeta): Promise<ProbeOk> {
  const web = expectMeta(meta, "web");
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
  return {
    pids: [serverPid, vitePid],
    lines: [
      `  app     ${web.appUrl}`,
      `  api     http://127.0.0.1:${web.piePort}/api/health`,
      `  home    ${web.pieHome}`,
      `  server  pid ${serverPid}`,
      `  vite    pid ${vitePid}`,
      `  node    v${process.versions.node}`,
      "  ticket  /api/ws-ticket 200",
      warn,
    ],
  };
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

export async function extraEvidence(
  command: string,
  rest: string[],
  dest: string,
  typed: WebRunMeta,
): Promise<boolean> {
  const session = sessionName();
  switch (command) {
    case "screenshot":
      console.log(saveScreenshot(dest, rest[0] ?? "screen", { session }));
      return true;
    case "snapshot":
      console.log(saveSnapshot(dest, rest[0] ?? "snapshot", { session }));
      return true;
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
      copySideEffects(typed.pieHome, side, true);
      console.log(side);
      return true;
    }
    default:
      return false;
  }
}

export async function browserWeb(args: string[]): Promise<void> {
  const session = sessionName();
  const usageText = `Usage:
  ${WEB.bin} browser open [url]
  ${WEB.bin} browser snapshot
  ${WEB.bin} browser install|skills|--version
  ${WEB.bin} browser <agent-browser argv…>

Uses the agent-browser dependency of @getpie/verify with --session ${session}.
\`open\` with no URL uses http://localhost:${VITE_PORT}/.
`;
  if (isHelpFlag(args[0])) {
    process.stdout.write(usageText);
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
