import events from "node:events";
import fs from "node:fs";
import path from "node:path";

import { DESKTOP } from "../identity.ts";
import { browserEnvForRun, driveHintLines, writeBrowserEnvFile } from "../lifecycle/env.ts";
import { expectMeta, patchRunMeta, type DesktopRunMeta, type RunMeta } from "../meta.ts";
import { agentBrowser, applyBrowserEnv, saveScreenshot, saveSnapshot } from "../runtime/browser.ts";
import { daemonPidPath, readDaemonRecord, stopRecordedDaemon } from "../runtime/daemon.ts";
import { copySideEffects } from "../runtime/evidence.ts";
import { fail, VerifyError } from "../runtime/fail.ts";
import { removePath, writeText } from "../runtime/fs.ts";
import {
  cdpOk,
  fetchText,
  healthOk,
  loopbackOrigins,
  ticketStatus,
  urlPort,
} from "../runtime/http.ts";
import {
  killTree,
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
  return DESKTOP.browserSession;
}

export const desktopSurface: Surface = {
  identity: DESKTOP,
  spawn: startDesktop,
  probe: inspectDesktop,
  stop: stopDesktop,
};

async function startDesktop(ctx: LaunchCtx): Promise<void> {
  const controller = new AbortController();
  const onInterrupt = () =>
    controller.abort(new VerifyError("Desktop launch cancelled (SIGINT)", 130));
  const onTerminate = () =>
    controller.abort(new VerifyError("Desktop launch cancelled (SIGTERM)", 143));
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    await installElectron(ctx, controller.signal);
    await startElectron(ctx, controller);
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

async function installElectron(ctx: LaunchCtx, signal: AbortSignal): Promise<void> {
  const desktop = expectLaunch(ctx, "desktop");
  const logPath = path.join(desktop.runDir, "logs/electron-vite.log");
  const pidPath = path.join(desktop.runDir, "pids/electron-vite.pid");
  console.log(`${DESKTOP.logPrefix}: ensuring Electron is installed (log: ${logPath})`);
  const child = spawnLogged("pnpm", ["exec", "install-electron"], logPath, {
    cwd: path.join(desktop.repo, "apps/desktop"),
    env: desktop.env,
  });
  // Unlike the long-lived Desktop process, keep Node alive until installation finishes.
  child.ref();
  if (child.pid !== undefined) writePidFile(pidPath, child.pid);
  await events.once(child, "exit", { signal });
  if (child.exitCode !== 0) {
    throw new Error(
      `Electron installation exited with ${child.signalCode ?? `code ${child.exitCode}`} (log: ${logPath})`,
    );
  }
  removePath(pidPath);
}

async function startElectron(ctx: LaunchCtx, controller: AbortController): Promise<void> {
  const desktop = expectLaunch(ctx, "desktop");
  controller.signal.throwIfAborted();
  const logPath = path.join(desktop.runDir, "logs/electron-vite.log");
  const viteArgs = ["run", "dev"];
  const child =
    process.platform !== "darwin" && process.env.DISPLAY === undefined
      ? spawnLogged("xvfb-run", ["-a", "pnpm", ...viteArgs], logPath, {
          cwd: path.join(desktop.repo, "apps/desktop"),
          env: desktop.env,
        })
      : spawnLogged("pnpm", viteArgs, logPath, {
          cwd: path.join(desktop.repo, "apps/desktop"),
          env: desktop.env,
        });
  child.once("error", (error) => controller.abort(error));
  child.once("exit", (code, signal) => {
    controller.abort(
      new Error(
        `Desktop launch exited with ${signal ?? `code ${code}`} before readiness (log: ${logPath})`,
      ),
    );
  });
  if (child.pid === undefined) {
    throw new Error("failed to spawn electron-vite");
  }
  writePidFile(path.join(desktop.runDir, "pids/electron-vite.pid"), child.pid);

  const recordPath = daemonPidPath(desktop.pieHome);
  await waitUntil("daemon.pid", () => fs.existsSync(recordPath), 90, controller.signal);
  const record = readDaemonRecord(recordPath);
  await waitUntil(
    `daemon health at ${record.address}`,
    () => healthOk(record.address),
    40,
    controller.signal,
  );
  let page: DesktopPage | undefined;
  await waitUntil(
    `Pie renderer on CDP ${desktop.cdpPort}`,
    async () => {
      if (!(await cdpOk(desktop.cdpPort))) return false;
      page = await ownedDesktopPage(desktop.cdpPort, child.pid);
      return page !== undefined;
    },
    40,
    controller.signal,
  );
  if (page === undefined) throw new Error("missing Pie renderer");
  writeBrowserEnvFile(DESKTOP, desktop.runDir);
  applyBrowserEnv(browserEnvForRun(DESKTOP, desktop.runDir), process.env);
  // Only a fresh run may adopt a target. All later commands retain the native sticky pin.
  agentBrowser(["--no-pin-tab", "tab", page.id], {
    session: sessionName(),
    cdpPort: desktop.cdpPort,
  });
  inspectBrowser(desktop.cdpPort, page);
  controller.signal.throwIfAborted();
  const bound = urlPort(record.address);
  patchRunMeta(path.join(desktop.runDir, "meta.json"), "desktop", {
    address: record.address,
    daemonPid: record.pid,
    piePort: bound,
  });
  console.log(`${DESKTOP.logPrefix}: launched ${desktop.runId}`);
  console.log(`  api     ${record.address}/api/health`);
  console.log(`  port    ${bound} (first spawn prefers 4000; this is the bound address)`);
  console.log(`  pid     electron-vite ${child.pid} daemon ${record.pid}`);
  console.log(`  home    ${desktop.pieHome}`);
  console.log(`  sample  ${desktop.sample.path}`);
  console.log(`  logs    ${path.join(desktop.runDir, "logs")}`);
  console.log(`  doctor  ${DESKTOP.bin} doctor`);
  for (const line of driveHintLines(DESKTOP)) {
    console.log(line);
  }
}

async function inspectDesktop(runDir: string, meta: RunMeta): Promise<ProbeOk> {
  const desktop = expectMeta(meta, "desktop");
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  if (!pidAlive(evPid)) {
    fail(`${DESKTOP.logPrefix} FAIL — electron-vite pid ${evPid} is not running`);
  }
  const recordPath = daemonPidPath(desktop.pieHome);
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
  let targetId = "";
  const session = sessionName();
  try {
    const page = await ownedDesktopPage(desktop.cdpPort, evPid);
    if (page === undefined) throw new Error("missing Pie renderer; launch a fresh run");
    applyBrowserEnv(browserEnvForRun(DESKTOP, runDir), process.env);
    ({ title, url, targetId } = inspectBrowser(desktop.cdpPort, page));
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
      `  cdp     ${desktop.cdpPort} (doctor already attached session ${session})`,
      `  target  ${targetId} (pinned)`,
      `  title   ${title || "(empty)"}`,
      `  url     ${url || "(empty)"}`,
      `  home    ${desktop.pieHome}`,
      `  evite   pid ${evPid}`,
      `  daemon  pid ${record.pid}`,
      "  ticket  anonymous 401 / bearer 200",
      ...driveHintLines(DESKTOP),
    ],
  };
}

type DesktopPage = { id: string; url: string };

async function ownedDesktopPage(
  cdpPort: number,
  evPid: number | undefined,
): Promise<DesktopPage | undefined> {
  if (evPid === undefined || !portOwnedByAncestor(cdpPort, evPid)) {
    throw new Error(`CDP ${cdpPort} is not owned by this Desktop run`);
  }
  const response = await fetchText(`http://127.0.0.1:${cdpPort}/json/list`);
  const targets: unknown = JSON.parse(response?.body ?? "null");
  if (response?.status !== 200 || !Array.isArray(targets))
    throw new Error("invalid CDP target list");
  const pages = targets.filter(
    (target: unknown): target is DesktopPage =>
      typeof target === "object" &&
      target !== null &&
      "type" in target &&
      target.type === "page" &&
      "id" in target &&
      typeof target.id === "string" &&
      target.id !== "" &&
      "url" in target &&
      typeof target.url === "string" &&
      !target.url.startsWith("devtools://"),
  );
  if (pages.length > 1) throw new Error("ambiguous Desktop renderer: expected one page");
  const page = pages[0];
  if (page === undefined || page.url === "about:blank") return undefined;
  const port = urlPort(page.url);
  if (
    !loopbackOrigins(port).includes(new URL(page.url).origin) ||
    !portOwnedByAncestor(port, evPid)
  ) {
    throw new Error("renderer origin is not owned by this Desktop run");
  }
  return page;
}

function inspectBrowser(cdpPort: number, page: DesktopPage) {
  const target = { session: sessionName(), cdpPort };
  const endpoint = new URL(agentBrowser(["get", "cdp-url"], target).trim());
  if (!loopbackOrigins(cdpPort).includes(endpoint.origin.replace(/^ws:/, "http:"))) {
    throw new Error(`agent-browser is attached to a different CDP endpoint (expected ${cdpPort})`);
  }
  const result: unknown = JSON.parse(agentBrowser(["--json", "tab"], target));
  if (
    typeof result !== "object" ||
    result === null ||
    !("data" in result) ||
    typeof result.data !== "object" ||
    result.data === null ||
    !("tabs" in result.data) ||
    !Array.isArray(result.data.tabs)
  )
    throw new Error("invalid agent-browser tab list");
  const active = result.data.tabs.filter(
    (tab: unknown): tab is Record<"active", unknown> =>
      typeof tab === "object" && tab !== null && "active" in tab && tab.active === true,
  );
  const bound = active[0];
  if (
    active.length !== 1 ||
    bound === undefined ||
    !("targetId" in bound) ||
    bound.targetId !== page.id
  ) {
    throw new Error("agent-browser is not pinned to this Desktop renderer; launch a fresh run");
  }
  const title = agentBrowser(["get", "title"], target).trim();
  const url = agentBrowser(["get", "url"], target).trim();
  if (new URL(url).origin !== new URL(page.url).origin) {
    throw new Error("agent-browser renderer origin does not match this Desktop run");
  }
  return { title, url, targetId: page.id };
}

async function stopDesktop(runDir: string, meta: RunMeta | undefined): Promise<void> {
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  console.log(`${DESKTOP.logPrefix}: stopping desktop launch pid=${evPid ?? "none"}`);
  killTree(evPid);
  await waitDead(evPid);
  if (meta?.surface === "desktop") {
    await stopRecordedDaemon({
      repo: meta.repo,
      pieHome: meta.pieHome,
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
  const record = readDaemonRecord(daemonPidPath(meta.pieHome));
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
    `agent-browser --session ${session} get title`,
    title,
    `agent-browser --session ${session} get url`,
    url,
    "",
  ].join("\n");
}
