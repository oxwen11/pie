import childProcess from "node:child_process";
import events from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { commandOnPath, killTree, pidAlive, waitDead } from "../runtime/process.ts";

const roots: string[] = [];
const children: childProcess.ChildProcess[] = [];
const cli = path.resolve(import.meta.dirname, "../cli.ts");

async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-desktop-startup-test-"));
  roots.push(root);
  for (const dir of ["bin", "home", "apps/desktop", "packages/pie", "packages/server/dist"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  fs.writeFileSync(path.join(root, "packages/server/dist/server.mjs"), "");
  fs.writeFileSync(
    path.join(root, "bin/pnpm"),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TRACE, JSON.stringify({ args, pid: process.pid }) + '\\n');
if (args.join(' ') === 'exec install-electron') {
  if (process.env.INSTALL_CHILD === '1') {
    const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.TRACE + '.child', String(child.pid));
  }
  const done = () => { console.log('installer output'); process.exit(Number(process.env.INSTALL_EXIT || 0)); };
  if (process.env.INSTALL_GATE) setInterval(() => { if (fs.existsSync(process.env.INSTALL_GATE)) done(); }, 20);
  else done();
} else if (args.join(' ') === 'run dev') {
  if (process.env.DEV_EXIT !== undefined) process.exit(Number(process.env.DEV_EXIT));
  else if (process.env.DEV_HANG === '1') setInterval(() => {}, 1000);
  else {
    const server = http.createServer((req, res) => {
      if ((process.env.DEV_FAIL_AT === 'health' && req.url === '/api/health') ||
          (process.env.DEV_FAIL_AT === 'cdp' && req.url === '/json/version')) {
        console.log('exiting at ' + process.env.DEV_FAIL_AT);
        process.exit(24);
      }
      res.end('ok');
    });
    server.listen(Number(process.env.PIE_REMOTE_DEBUG_PORT), '127.0.0.1', () => {
      fs.writeFileSync(path.join(process.env.PIE_HOME, 'daemon/daemon.pid'), JSON.stringify({
        pid: process.pid, address: 'http://127.0.0.1:' + process.env.PIE_REMOTE_DEBUG_PORT, token: 'fixture-token'
      }));
    });
  }
}
`,
    { mode: 0o755 },
  );
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await events.once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test port");
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(root, "home"),
    PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
    VERIFY_PIE_REPO: root,
    VERIFY_PIE_DESKTOP_ROOT: path.join(root, "run"),
    VERIFY_PIE_AGENT_BROWSER: process.execPath,
    PIE_REMOTE_DEBUG_PORT: String(address.port),
    DISPLAY: ":test",
    TRACE: path.join(root, "trace"),
    ...overrides,
  };
  return { root, env };
}

function start(env: NodeJS.ProcessEnv) {
  const child = childProcess.spawn(process.execPath, [cli, "desktop", "launch"], { env });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const exited = events.once(child, "close").then(() => ({ code: child.exitCode, output }));
  return { child, exited };
}

function trace(root: string): Array<{ args: string[]; pid: number }> {
  const file = path.join(root, "trace");
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

async function stopped(root: string) {
  const pids = trace(root).map((entry) => entry.pid);
  const childFile = path.join(root, "trace.child");
  if (fs.existsSync(childFile)) pids.push(Number(fs.readFileSync(childFile, "utf8")));
  await vi.waitFor(() => expect(pids.some(pidAlive)).toBe(false), { timeout: 5000 });
  expect(fs.existsSync(path.join(root, "run/current"))).toBe(false);
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    killTree(child.pid);
    await waitDead(child.pid);
  }
  for (const root of roots.splice(0)) {
    const pids = trace(root).map((entry) => entry.pid);
    const childFile = path.join(root, "trace.child");
    if (fs.existsSync(childFile)) pids.push(Number(fs.readFileSync(childFile, "utf8")));
    for (const pid of pids) {
      killTree(pid);
      await waitDead(pid);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop launch lifecycle", () => {
  it("waits for installation before starting Desktop, using the shared dev script", async () => {
    const { root, env } = await fixture();
    env.INSTALL_GATE = path.join(root, "continue");
    const { child, exited } = start(env);
    await vi.waitFor(
      async () => {
        if (child.exitCode !== null) {
          const result = await exited;
          throw new Error(result.output);
        }
        expect(trace(root)[0]?.args).toEqual(["exec", "install-electron"]);
      },
      { timeout: 5000 },
    );
    expect(trace(root)).toHaveLength(1);
    const pidPath = path.join(root, "run/current/pids/electron-vite.pid");
    expect(Number(fs.readFileSync(pidPath, "utf8"))).toBe(trace(root)[0]?.pid);
    fs.writeFileSync(env.INSTALL_GATE, "go");
    const result = await exited;
    expect(result.code).toBe(0);
    expect(trace(root).map((entry) => entry.args)).toEqual([
      ["exec", "install-electron"],
      ["run", "dev"],
    ]);
    expect(Number(fs.readFileSync(pidPath, "utf8"))).toBe(trace(root)[1]?.pid);
  }, 10_000);

  it("reports installation failure without starting Desktop and preserves the log", async () => {
    const { root, env } = await fixture({ INSTALL_EXIT: "17" });
    const result = await start(env).exited;
    expect(result.code).toBe(1);
    expect(result.output).toContain("Electron installation exited with code 17");
    expect(trace(root).some((entry) => entry.args[0] === "run")).toBe(false);
    expect(
      fs.readFileSync(path.join(root, "run/last-failure/electron-vite.log"), "utf8"),
    ).toContain("installer output");
    await stopped(root);
  }, 10_000);

  it("reports a failed installer spawn without an unhandled process error", async () => {
    const { root, env } = await fixture();
    fs.rmSync(path.join(root, "bin/pnpm"));
    const lsof = commandOnPath("lsof");
    if (lsof === undefined) throw new Error("lsof is required for the launch port check");
    fs.symlinkSync(lsof, path.join(root, "bin/lsof"));
    env.PATH = path.join(root, "bin");
    const result = await start(env).exited;
    expect(result.code).toBe(1);
    expect(result.output).toContain("spawn pnpm ENOENT");
    expect(result.output).not.toContain("Unhandled 'error'");
    await stopped(root);
  }, 10_000);

  it.each([0, 23])(
    "fails promptly if Desktop exits before readiness (code %i)",
    async (code) => {
      const { root, env } = await fixture({ DEV_EXIT: String(code) });
      const result = await start(env).exited;
      expect(result.code).toBe(1);
      expect(result.output).toContain(`Desktop launch exited with code ${code}`);
      expect(result.output).not.toContain("timed out");
      await stopped(root);
    },
    10_000,
  );

  it.each(["health", "cdp"])(
    "detects exit during %s readiness",
    async (stage) => {
      const { root, env } = await fixture({ DEV_FAIL_AT: stage });
      const result = await start(env).exited;
      expect(result.code).toBe(1);
      expect(result.output).toContain("Desktop launch exited with code 24");
      expect(result.output).toContain(`exiting at ${stage}`);
      expect(result.output).not.toContain("timed out");
      await stopped(root);
    },
    10_000,
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans up the installer tree on %s",
    async (signal) => {
      const { root, env } = await fixture({ INSTALL_CHILD: "1" });
      env.INSTALL_GATE = path.join(root, "never");
      const { child, exited } = start(env);
      await vi.waitFor(() => expect(fs.existsSync(path.join(root, "trace.child"))).toBe(true), {
        timeout: 5000,
      });
      child.kill(signal);
      const result = await exited;
      expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
      expect(result.output).toContain(`Desktop launch cancelled (${signal})`);
      expect(trace(root).some((entry) => entry.args[0] === "run")).toBe(false);
      await stopped(root);
    },
    10_000,
  );

  it("cleans up when cancelled while waiting for Desktop readiness", async () => {
    const { root, env } = await fixture({ DEV_HANG: "1" });
    const { child, exited } = start(env);
    await vi.waitFor(
      () => expect(trace(root).some((entry) => entry.args[0] === "run")).toBe(true),
      { timeout: 5000 },
    );
    child.kill("SIGINT");
    const result = await exited;
    expect(result.code).toBe(130);
    await stopped(root);
  }, 10_000);
});
