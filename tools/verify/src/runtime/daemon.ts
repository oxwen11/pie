import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { readJson, readText, writeJson } from "./fs.ts";
import {
  type CommandResult,
  killTree,
  pidAlive,
  runCommand,
  spawnLogged,
  waitDead,
} from "./process.ts";

export type DaemonRecord = {
  pid: number;
  address: string;
  token: string;
  startedAt?: string;
  compatibilityKey?: string;
};

export function readDaemonRecord(filePath: string): DaemonRecord {
  const data = readJson<Record<string, unknown>>(filePath);
  if (
    typeof data.pid !== "number" ||
    typeof data.address !== "string" ||
    typeof data.token !== "string"
  ) {
    throw new TypeError(`invalid daemon.pid at ${filePath}`);
  }
  return data as DaemonRecord;
}

export function redactDaemonRecord(src: string, dest: string): void {
  const data = readJson<Record<string, unknown>>(src);
  if (Object.hasOwn(data, "token")) {
    data.token = "[redacted]";
  }
  writeJson(dest, data);
}

export function ensureCoreBuilt(repo: string): void {
  if (fs.existsSync(path.join(repo, "packages/core/dist/compatibility.mjs"))) {
    return;
  }
  console.log("building @getpie/core (packages/core/dist missing)");
  const result = runCommand("pnpm", ["turbo", "run", "build", "--filter=@getpie/core"], {
    cwd: repo,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("turbo build @getpie/core failed");
  }
}

export function ensureServerBuilt(repo: string): void {
  if (fs.existsSync(path.join(repo, "packages/server/dist/server.mjs"))) {
    return;
  }
  console.log("building @getpie/server (packages/server/dist/server.mjs missing)");
  const result = runCommand("pnpm", ["turbo", "run", "build", "--filter=@getpie/server"], {
    cwd: repo,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("turbo build @getpie/server failed");
  }
}

export async function resolveCompatKey(repo: string): Promise<string> {
  const href = url.pathToFileURL(path.join(repo, "packages/core/dist/compatibility.mjs")).href;
  const mod = (await import(href)) as {
    resolveDaemonCompatibilityKey: (options: { cwd: string }) => string;
  };
  return mod.resolveDaemonCompatibilityKey({ cwd: repo });
}

const pieArgv = ["exec", "tsx", "src/node/cli.ts"];

export function invokePie(
  repo: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: { inherit?: boolean; logPath?: string } = {},
): CommandResult {
  const cwd = path.join(repo, "packages/pie");
  if (options.logPath !== undefined) {
    const fd = fs.openSync(options.logPath, "a");
    return runCommand("pnpm", [...pieArgv, ...args], { cwd, env, stdio: ["ignore", fd, fd] });
  }
  return runCommand("pnpm", [...pieArgv, ...args], {
    cwd,
    env,
    stdio: options.inherit === true ? "inherit" : "pipe",
  });
}

export function spawnPie(
  repo: string,
  args: string[],
  logPath: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawnLogged("pnpm", [...pieArgv, ...args], logPath, {
    cwd: path.join(repo, "packages/pie"),
    env,
  });
}

export async function stopRecordedDaemon(input: {
  repo: string;
  pieHome: string;
  daemonDir: string;
  piePort: number;
  runDir: string;
  logPrefix: string;
}): Promise<void> {
  const env = {
    ...process.env,
    PIE_HOME: input.pieHome,
    PIE_DAEMON_DIR: input.daemonDir,
    PIE_PORT: String(input.piePort),
    NODE_ENV: "development",
  };
  const recordPath = path.join(input.daemonDir, "daemon.pid");
  const daemonPid = fs.existsSync(recordPath) ? readDaemonRecord(recordPath).pid : undefined;
  console.log(`${input.logPrefix}: pie daemon stop (recorded pid=${daemonPid ?? "none"})`);
  invokePie(input.repo, ["daemon", "stop"], env, {
    logPath: path.join(input.runDir, "logs/cli-stop.log"),
  });
  const stopLog = path.join(input.runDir, "logs/cli-stop.log");
  if (fs.existsSync(stopLog)) {
    process.stdout.write(readText(stopLog));
  }
  if (daemonPid !== undefined && pidAlive(daemonPid)) {
    console.log(
      `${input.logPrefix}: daemon still alive after stop; killing recorded pid ${daemonPid}`,
    );
    killTree(daemonPid);
    await waitDead(daemonPid);
  }
}
