import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function assertNode24(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new Error(`Need Node >= 24 (found ${process.versions.node}). Use the skill bin wrapper.`);
  }
}

export function findRepoRoot(from = fileURLToPath(import.meta.url)): string {
  if (process.env.VERIFY_PIE_REPO && existsSync(join(process.env.VERIFY_PIE_REPO, "pnpm-workspace.yaml"))) {
    return process.env.VERIFY_PIE_REPO;
  }
  let dir = dirname(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("could not find the pie repo root (pnpm-workspace.yaml)");
    }
    dir = parent;
  }
}

export function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid ${name}=${raw}`);
  }
  return port;
}

export function commandOnPath(name: string): string | undefined {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (dir === "") {
      continue;
    }
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

export function pidAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(path: string): number | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = readFileSync(path, "utf8").trim();
  if (raw === "") {
    return undefined;
  }
  const pid = Number(raw);
  return Number.isInteger(pid) ? pid : undefined;
}

export function writePidFile(path: string, pid: number): void {
  writeFileSync(path, `${pid}\n`);
}

export function listenPids(port: number): number[] {
  if (commandOnPath("lsof") === undefined) {
    throw new Error(`lsof is required to check port ${port}`);
  }
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (result.status !== 0 && result.stdout.trim() === "") {
    return [];
  }
  const pids = new Set<number>();
  for (const line of result.stdout.split(/\s+/)) {
    const pid = Number(line);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids].toSorted((a, b) => a - b);
}

export function parentPid(pid: number): number | undefined {
  const result = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
  const parent = Number(result.stdout.trim());
  if (!Number.isInteger(parent) || parent <= 0) {
    return undefined;
  }
  return parent;
}

export function portOwnedByAncestor(port: number, ancestor: number): boolean {
  for (const pid of listenPids(port)) {
    let walk: number | undefined = pid;
    for (let i = 0; i < 8 && walk !== undefined; i++) {
      if (walk === ancestor) {
        return true;
      }
      if (walk === 1) {
        break;
      }
      walk = parentPid(walk);
    }
  }
  return false;
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (children.status === 0) {
    for (const line of children.stdout.split(/\s+/)) {
      const child = Number(line);
      if (Number.isInteger(child) && child > 0) {
        killTree(child);
      }
    }
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

export async function waitDead(pid: number | undefined, attempts = 20): Promise<void> {
  if (pid === undefined) {
    return;
  }
  for (let i = 0; i < attempts; i++) {
    if (!pidAlive(pid)) {
      return;
    }
    await sleep(250);
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitUntil(name: string, check: () => boolean | Promise<boolean>, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${name}`);
}

export function runCommand(
  command: string,
  args: string[],
  options: SpawnOptions & { input?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function spawnLogged(command: string, args: string[], logPath: string, options: SpawnOptions = {}): ChildProcess {
  const fd = openSync(logPath, "a");
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  return child;
}

export function isSharedPieHome(pieHome: string): boolean {
  const home = process.env.HOME ?? "";
  return pieHome === join(home, ".pie") || pieHome === join(home, ".pie-dev");
}
