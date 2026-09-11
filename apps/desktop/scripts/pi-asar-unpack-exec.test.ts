import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unpackPiNodeModules } from "./pi-asar-unpack";

const desktopRoot = path.dirname(import.meta.dirname);

const resolveBun = (): string | undefined => {
  const printed = childProcess.spawnSync("bun", ["--print", "process.execPath"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (printed.status !== 0) return undefined;
  const execPath = printed.stdout.trim();
  return execPath.length > 0 && fs.existsSync(execPath) ? execPath : undefined;
};

const bun = resolveBun();
const PI_MISSING = "@earendil-works/pi-coding-agent";

const spawnRpcChild = (command: string, entry: string, cwd: string, home: string) =>
  childProcess.spawn(command, [entry, "--mode", "rpc", "--session-id", "unpack-exec"], {
    cwd,
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "ignore", "pipe"],
  });

const loadModuleGraph = async (command: string, entry: string, cwd: string, home: string) => {
  const child = spawnRpcChild(command, entry, cwd, home);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 1500);
  });
  const exitCode = child.exitCode;
  child.kill("SIGKILL");
  return { stderr, exitCode };
};

describe("Pi unpack tree is executable", { timeout: 30_000 }, () => {
  let treeRoot: string;
  let entry: string;
  let workspace: string;
  let home: string;

  beforeAll(async () => {
    treeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-asar-unpack-exec-"));
    workspace = path.join(treeRoot, "ws");
    home = path.join(treeRoot, "home");
    fs.mkdirSync(workspace);
    fs.mkdirSync(home);
    entry = await unpackPiNodeModules(desktopRoot, treeRoot);
  }, 60_000);

  afterAll(() => {
    if (treeRoot !== undefined) fs.rmSync(treeRoot, { recursive: true, force: true });
  });

  it("starts under Node from only the unpacked package set", async () => {
    const { stderr } = await loadModuleGraph(process.execPath, entry, workspace, home);
    expect(stderr).not.toMatch(/Cannot find module|Module not found/i);
  });

  it.skipIf(bun === undefined)("starts under bun from only the unpacked package set", async () => {
    const { stderr } = await loadModuleGraph(bun!, entry, workspace, home);
    expect(stderr).not.toMatch(/Cannot find module|Module not found/i);
  });

  it("fails under Node when a required unpack package is missing", async () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "pi-asar-unpack-exec-missing-"));
    const ws = path.join(isolated, "ws");
    const isolatedHome = path.join(isolated, "home");
    try {
      fs.cpSync(treeRoot, isolated, { recursive: true });
      fs.rmSync(path.join(isolated, "node_modules", PI_MISSING), { recursive: true, force: true });
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(isolatedHome, { recursive: true });
      const isolatedEntry = path.join(isolated, path.relative(treeRoot, entry));
      const child = spawnRpcChild(process.execPath, isolatedEntry, ws, isolatedHome);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve) => {
        child.on("exit", (exitCode) => resolve(exitCode));
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(child.exitCode);
        }, 2000);
      });
      expect(code === 1 || /Cannot find module|Module not found/i.test(stderr)).toBe(true);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});
