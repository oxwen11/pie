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
      if (req.url === '/api/ws-ticket') res.statusCode = req.headers.authorization ? 200 : 401;
      if (req.url === '/json/list') {
        const pages = [{ type: 'page', id: 'fixture-page',
          url: process.env.PAGE_URL || 'http://127.0.0.1:' + process.env.PIE_REMOTE_DEBUG_PORT + '/draft' }];
        if (process.env.EXTRA_PAGE === '1') pages.push({ ...pages[0], id: 'second-page' });
        res.end(JSON.stringify(pages));
      } else res.end('ok');
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
  fs.writeFileSync(
    path.join(root, "bin/agent-browser"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('AGENT_BROWSER_')));
fs.appendFileSync(process.env.TRACE + '.browser', JSON.stringify({ args, env }) + '\\n');
const binding = process.env.TRACE + '.binding';
if (args.includes('--no-pin-tab')) {
  if (!args.includes('fixture-page')) throw new Error('must select the existing target');
  fs.writeFileSync(binding, 'fixture-page');
} else {
  if (!fs.existsSync(binding)) throw new Error('Target.createTarget: Not supported');
  if (process.env.TAB_GONE === '1') throw new Error('bound target is gone');
  if (args.includes('tab')) console.log(process.env.TAB_LIST_JSON || JSON.stringify({ success: true, data: { tabs: [
    { active: true, targetId: process.env.ACTIVE_TARGET || 'fixture-page' }
  ] } }));
  else if (args.includes('cdp-url')) console.log('ws://127.0.0.1:' + (process.env.BROWSER_CDP || env.AGENT_BROWSER_CDP) + '/devtools/browser/fixture');
  else if (args.includes('title')) console.log('Pie');
  else if (args.includes('url')) console.log('http://127.0.0.1:' + env.AGENT_BROWSER_CDP + '/draft');
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
    VERIFY_PIE_AGENT_BROWSER: path.join(root, "bin/agent-browser"),
    PIE_REMOTE_DEBUG_PORT: String(address.port),
    DISPLAY: ":test",
    TRACE: path.join(root, "trace"),
    ...overrides,
  };
  return { root, env };
}

function start(env: NodeJS.ProcessEnv, ...args: string[]) {
  const child = childProcess.spawn(
    process.execPath,
    [cli, "desktop", ...(args.length > 0 ? args : ["launch"])],
    { env },
  );
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

function browserTrace(root: string): Array<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const file = path.join(root, "trace.browser");
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
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
    const calls = browserTrace(root);
    expect(calls[0]?.args).toContain("--no-pin-tab");
    expect(calls[0]?.args).toContain("fixture-page");
    expect(calls.slice(1).every((call) => !call.args.includes("--no-pin-tab"))).toBe(true);
    expect(calls.at(-1)?.env.AGENT_BROWSER_PIN_TAB).toBe("true");
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

describe("desktop browser binding", () => {
  it("uses the run environment for Doctor, reuse, drive and all browser evidence without rebinding", async () => {
    const { root, env } = await fixture();
    await expect(start(env).exited).resolves.toMatchObject({ code: 0 });
    const initial = browserTrace(root)[0]?.env;
    const poisoned = {
      ...env,
      AGENT_BROWSER_CDP: "1",
      AGENT_BROWSER_SOCKET_DIR: "/tmp/foreign-browser",
      AGENT_BROWSER_NAMESPACE: "foreign",
      AGENT_BROWSER_CONFIG: "/tmp/foreign-browser.json",
      AGENT_BROWSER_PROFILE: "/tmp/foreign-profile",
      AGENT_BROWSER_PIN_TAB: "false",
    };
    for (const args of [
      ["doctor"],
      ["launch"],
      ["evidence", "screenshot"],
      ["evidence", "snapshot"],
      ["evidence", "curl"],
    ]) {
      const result = await start(poisoned, ...args).exited;
      expect(result).toMatchObject({ code: 0 });
    }
    const drive = childProcess.spawnSync(
      path.join(root, "run/bin/agent-browser"),
      ["get", "title"],
      { env: poisoned, encoding: "utf8" },
    );
    expect(drive.status).toBe(0);
    expect(drive.stdout.trim()).toBe("Pie");
    const calls = browserTrace(root);
    expect(calls.filter((call) => call.args.includes("--no-pin-tab"))).toHaveLength(1);
    for (const call of calls) {
      expect(call.env.AGENT_BROWSER_CDP).toBe(env.PIE_REMOTE_DEBUG_PORT);
      expect(call.env.AGENT_BROWSER_SOCKET_DIR).toBe(initial?.AGENT_BROWSER_SOCKET_DIR);
      expect(fs.realpathSync(call.env.AGENT_BROWSER_CONFIG ?? "")).toBe(
        fs.realpathSync(initial?.AGENT_BROWSER_CONFIG ?? ""),
      );
      expect(call.env.AGENT_BROWSER_NAMESPACE).toBe(initial?.AGENT_BROWSER_NAMESPACE);
      expect(call.env.AGENT_BROWSER_PIN_TAB).toBe("true");
      expect(call.env.AGENT_BROWSER_PROFILE).toBeUndefined();
    }
  }, 20_000);

  it.each([
    [{ TAB_GONE: "1" }, "bound target is gone"],
    [{ ACTIVE_TARGET: "replacement" }, "not pinned to this Desktop renderer"],
    [{ BROWSER_CDP: "1" }, "different CDP endpoint"],
    [{ TAB_LIST_JSON: "null" }, "invalid agent-browser tab list"],
  ])(
    "fails closed for a lost or mismatched browser (%j)",
    async (overrides, message) => {
      const { root, env } = await fixture();
      await expect(start(env).exited).resolves.toMatchObject({ code: 0 });
      const before = browserTrace(root).length;
      const result = await start({ ...env, ...overrides }, "doctor").exited;
      expect(result.code).toBe(1);
      expect(result.output).toContain(message);
      const calls = browserTrace(root).slice(before);
      expect(calls.some((call) => call.args.includes("--no-pin-tab"))).toBe(false);
      expect(calls.some((call) => call.args.includes("title"))).toBe(false);
      await expect(start({ ...env, ...overrides }, "launch").exited).resolves.toMatchObject({
        code: 1,
      });
      expect(browserTrace(root).filter((call) => call.args.includes("--no-pin-tab"))).toHaveLength(
        1,
      );
    },
    15_000,
  );

  it("refuses ambiguous renderers rather than selecting the first page", async () => {
    const { root, env } = await fixture({ EXTRA_PAGE: "1" });
    const result = await start(env).exited;
    expect(result.code).toBe(1);
    expect(result.output).toContain("ambiguous Desktop renderer");
    expect(browserTrace(root)).toHaveLength(0);
    await stopped(root);
  }, 10_000);

  it("rejects a renderer served by another run before attaching", async () => {
    const first = await fixture();
    await expect(start(first.env).exited).resolves.toMatchObject({ code: 0 });
    const second = await fixture({
      PAGE_URL: `http://127.0.0.1:${first.env.PIE_REMOTE_DEBUG_PORT}/draft`,
    });
    const result = await start(second.env).exited;
    expect(result.code).toBe(1);
    expect(result.output).toContain("renderer origin is not owned by this Desktop run");
    expect(browserTrace(second.root)).toHaveLength(0);
    await expect(start(first.env, "doctor").exited).resolves.toMatchObject({ code: 0 });
  }, 15_000);

  it("isolates parallel runs and rejects another run's CDP owner without touching either browser", async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(start(first.env).exited).resolves.toMatchObject({ code: 0 });
    await expect(start(second.env).exited).resolves.toMatchObject({ code: 0 });
    expect(browserTrace(first.root)[0]?.env.AGENT_BROWSER_SOCKET_DIR).not.toBe(
      browserTrace(second.root)[0]?.env.AGENT_BROWSER_SOCKET_DIR,
    );
    const before = browserTrace(first.root).length;
    fs.writeFileSync(
      path.join(first.root, "run/current/pids/electron-vite.pid"),
      String(trace(second.root)[1]?.pid),
    );
    const result = await start(first.env, "doctor").exited;
    expect(result.code).toBe(1);
    expect(result.output).toContain("is not owned by this Desktop run");
    expect(browserTrace(first.root)).toHaveLength(before);
    await expect(start(second.env, "doctor").exited).resolves.toMatchObject({ code: 0 });
  }, 15_000);
});
