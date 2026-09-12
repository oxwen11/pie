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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompatModule(value: unknown): value is {
  resolveDaemonCompatibilityKey: (options: { cwd: string }) => string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "resolveDaemonCompatibilityKey" in value &&
    typeof value.resolveDaemonCompatibilityKey === "function"
  );
}

export function readDaemonRecord(filePath: string): DaemonRecord {
  const data = readJson(filePath);
  if (
    !isRecord(data) ||
    typeof data.pid !== "number" ||
    typeof data.address !== "string" ||
    typeof data.token !== "string"
  ) {
    throw new TypeError(`invalid daemon.pid at ${filePath}`);
  }
  return {
    pid: data.pid,
    address: data.address,
    token: data.token,
    ...(typeof data.startedAt === "string" ? { startedAt: data.startedAt } : undefined),
    ...(typeof data.compatibilityKey === "string"
      ? { compatibilityKey: data.compatibilityKey }
      : undefined),
  };
}

export function redactDaemonRecord(src: string, dest: string): void {
  const data = readJson(src);
  if (!isRecord(data)) {
    writeJson(dest, data);
    return;
  }
  writeJson(dest, Object.hasOwn(data, "token") ? { ...data, token: "[redacted]" } : data);
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
  const mod: unknown = await import(href);
  if (!isCompatModule(mod)) {
    throw new TypeError(`invalid compatibility module at ${href}`);
  }
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
