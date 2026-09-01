import fs from "node:fs";
import path from "node:path";

import { CLI } from "../identity.ts";
import { expectMeta, patchRunMeta, readRunMeta, type CliRunMeta, type RunMeta } from "../meta.ts";
import {
  ensureCoreBuilt,
  invokePie,
  readDaemonRecord,
  resolveCompatKey,
  spawnPie,
  stopRecordedDaemon,
} from "../runtime/daemon.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun, readText, writeText } from "../runtime/fs.ts";
import { fetchText, healthOk, ticketStatus, urlPort } from "../runtime/http.ts";
import {
  findRepoRoot,
  killTree,
  listenPids,
  pidAlive,
  readPidFile,
  waitDead,
  waitUntil,
  writePidFile,
} from "../runtime/process.ts";
import { expectLaunch, type LaunchCtx, type ProbeOk, type Surface } from "../surface.ts";

export const cliSurface: Surface = {
  identity: CLI,
  spawn: startCli,
  probe: inspectCli,
  stop: stopCli,
};

async function startCli(ctx: LaunchCtx): Promise<void> {
  const cli = expectLaunch(ctx, "cli");
  const env = {
    ...cli.env,
    PIE_DAEMON_COMPATIBILITY_KEY: await resolveCompatKey(cli.repo),
  };
  if (cli.request.mode === "serve") {
    await startServe(cli, env);
    return;
  }
  await startDaemon(cli, env);
}

async function startServe(
  ctx: Extract<LaunchCtx, { surface: "cli" }>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawnPie(
    ctx.repo,
    ["serve", "--port", String(ctx.piePort)],
    path.join(ctx.runDir, "logs/serve.log"),
    env,
  );
  if (child.pid === undefined) {
    throw new Error("failed to spawn pie serve");
  }
  writePidFile(path.join(ctx.runDir, "pids/serve.pid"), child.pid);
  await waitUntil(`pie serve on ${ctx.piePort}`, () => healthOk(ctx.piePort), 60);
  const address = `http://127.0.0.1:${ctx.piePort}`;
  patchRunMeta(path.join(ctx.runDir, "meta.json"), "cli", { address });
  console.log(`${CLI.logPrefix}: launched ${ctx.runId}`);
  console.log("  mode    serve (foreground, no token)");
  console.log(`  api     ${address}/api/health`);
  console.log(`  home    ${ctx.pieHome}`);
  console.log(`  logs    ${path.join(ctx.runDir, "logs")}`);
  console.log(`  doctor  ${CLI.bin} doctor`);
}

async function startDaemon(
  ctx: Extract<LaunchCtx, { surface: "cli" }>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const startLog = path.join(ctx.runDir, "logs/cli-start.log");
  const started = invokePie(ctx.repo, ["daemon", "start", "--port", env.PIE_PORT ?? ""], env, {
    logPath: startLog,
  });
  if (started.status !== 0) {
    throw new Error("daemon start failed");
  }
  const recordPath = path.join(ctx.daemonDir, "daemon.pid");
  await waitUntil("daemon.pid", () => fs.existsSync(recordPath), 20);
  const record = readDaemonRecord(recordPath);
  await waitUntil(`daemon health at ${record.address}`, () => healthOk(record.address), 40);
  patchRunMeta(path.join(ctx.runDir, "meta.json"), "cli", {
    address: record.address,
    daemonPid: record.pid,
  });
  console.log(`${CLI.logPrefix}: launched ${ctx.runId}`);
  console.log("  mode    daemon");
  console.log(`  api     ${record.address}/api/health`);
  console.log(`  pid     ${record.pid}`);
  console.log(`  home    ${ctx.pieHome}`);
  if (fs.existsSync(startLog)) {
    console.log(`  start   ${readText(startLog).replaceAll("\n", "")}`);
  }
  console.log(`  doctor  ${CLI.bin} doctor`);
}

async function inspectCli(runDir: string, meta: RunMeta): Promise<ProbeOk> {
  const cli = expectMeta(meta, "cli");
  if (cli.mode === "serve") {
    const servePid = readPidFile(path.join(runDir, "pids/serve.pid"));
    if (!pidAlive(servePid)) {
      fail(`${CLI.logPrefix} doctor: FAIL — serve pid ${servePid} is not running`);
    }
    const address = `http://127.0.0.1:${cli.piePort}`;
    if (!(await healthOk(address))) {
      fail(`${CLI.logPrefix} doctor: FAIL — ${address}/api/health is not ok`);
    }
    const status = await ticketStatus(address);
    if (status !== 200) {
      fail(
        `${CLI.logPrefix} doctor: FAIL — serve /api/ws-ticket returned ${status} (expected 200, no token)`,
      );
    }
    return {
      pids: servePid === undefined ? [] : [servePid],
      lines: [
        "  mode    serve",
        `  api     ${address}/api/health`,
        `  home    ${cli.pieHome}`,
        `  serve   pid ${servePid}`,
        "  ticket  /api/ws-ticket 200 (no token)",
      ],
    };
  }

  const recordPath = path.join(cli.daemonDir, "daemon.pid");
  if (!fs.existsSync(recordPath)) {
    fail(`${CLI.logPrefix} doctor: FAIL — missing ${recordPath}`);
  }
  const record = readDaemonRecord(recordPath);
  if (!pidAlive(record.pid)) {
    fail(`${CLI.logPrefix} doctor: FAIL — daemon pid ${record.pid} is not running`);
  }
  if (!(await healthOk(record.address))) {
    fail(`${CLI.logPrefix} doctor: FAIL — ${record.address}/api/health is not ok`);
  }
  const anon = await ticketStatus(record.address);
  if (anon !== 401) {
    fail(
      `${CLI.logPrefix} doctor: FAIL — /api/ws-ticket without token returned ${anon} (expected 401 — 200 means you hit pie serve)`,
    );
  }
  const auth = await ticketStatus(record.address, record.token);
  if (auth !== 200) {
    fail(
      `${CLI.logPrefix} doctor: FAIL — /api/ws-ticket with record token returned ${auth} (expected 200)`,
    );
  }
  const port = urlPort(record.address);
  if (listenPids(port).length === 0) {
    fail(`${CLI.logPrefix} doctor: FAIL — nothing listens on ${port} (from daemon.pid address)`);
  }
  return {
    pids: [record.pid],
    lines: [
      "  mode    daemon",
      `  api     ${record.address}/api/health`,
      `  home    ${cli.pieHome}`,
      `  daemon  pid ${record.pid}`,
      "  ticket  anonymous 401 / bearer 200",
    ],
  };
}

async function stopCli(runDir: string, meta: RunMeta | undefined): Promise<void> {
  if (meta?.surface === "cli" && meta.mode === "serve") {
    const servePid = readPidFile(path.join(runDir, "pids/serve.pid"));
    console.log(`${CLI.logPrefix}: stopping serve pid=${servePid ?? "none"}`);
    killTree(servePid);
    await waitDead(servePid);
    return;
  }
  if (meta?.surface === "cli") {
    await stopRecordedDaemon({
      repo: meta.repo,
      pieHome: meta.pieHome,
      daemonDir: meta.daemonDir,
      piePort: meta.piePort,
      runDir,
      logPrefix: CLI.logPrefix,
    });
  }
}

export async function extraEvidence(
  command: string,
  rest: string[],
  dest: string,
  typed: CliRunMeta,
): Promise<boolean> {
  void rest;
  if (command !== "curl") {
    return false;
  }
  writeText(path.join(dest, "curl.txt"), await curlTranscript(typed));
  console.log(path.join(dest, "curl.txt"));
  return true;
}

async function curlTranscript(cli: CliRunMeta): Promise<string> {
  if (cli.mode === "serve") {
    const address = `http://127.0.0.1:${cli.piePort}`;
    const health = await fetchText(`${address}/api/health`);
    const ticket = await ticketStatus(address);
    return [
      `GET ${address}/api/health`,
      health?.body ?? "",
      "",
      `POST ${address}/api/ws-ticket (no token)`,
      `status ${ticket ?? "error"}`,
      "",
    ].join("\n");
  }
  const record = readDaemonRecord(path.join(cli.daemonDir, "daemon.pid"));
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  return [
    `GET ${record.address}/api/health`,
    health?.body ?? "",
    "",
    `POST ${record.address}/api/ws-ticket (no token)`,
    `status ${anon ?? "error"}`,
    `POST ${record.address}/api/ws-ticket (bearer)`,
    `status ${auth ?? "error"}`,
    "",
  ].join("\n");
}

export async function runPie(args: string[]): Promise<void> {
  const repo = findRepoRoot();
  ensureCoreBuilt(repo);
  const runDir = currentRun(CLI.currentLink);
  const helpOnly = isHelpOrVersion(args);
  if (runDir === undefined && !helpOnly) {
    throw new Error("no current run. Launch first.");
  }
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
  if (runDir !== undefined) {
    const cli = expectMeta(readRunMeta(path.join(runDir, "meta.json")), "cli");
    env.PIE_HOME = cli.pieHome;
    env.PIE_DAEMON_DIR = cli.daemonDir;
    env.PIE_PORT = String(cli.piePort);
    env.PIE_DAEMON_COMPATIBILITY_KEY =
      process.env.PIE_DAEMON_COMPATIBILITY_KEY ?? (await resolveCompatKey(repo));
  }
  const result = invokePie(repo, args, env, { inherit: true });
  if (result.status !== 0) {
    process.exitCode = result.status;
  }
}

export function isHelpOrVersion(args: string[]): boolean {
  return args.some(
    (arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v",
  );
}
