import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { killProcessTree } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { logsDirectory } from "../../../src/config/paths";
import {
  bashLogPath,
  executePieBash,
  filterPiBashEnv,
  openBashLog,
} from "../../../src/harness/pi/bash";

const HOST_ENV: NodeJS.ProcessEnv = {
  PIE_DAEMON_DIR: "daemon-beta",
  PIE_HOME: "/tmp/pie-home",
  PIE_AUTH_TOKEN: "secret",
  ELECTRON_RUN_AS_NODE: "1",
  ELECTRON_RENDERER_PORT: "5173",
  PORT: "5173",
  VITE_DEV_SERVER_URL: "http://localhost:5173",
  PATH: "/usr/bin:/bin",
  HOME: "/users/test",
  DISPLAY: ":0",
  HTTPS_PROXY: "http://proxy.example:8080",
  FOO_KEEP: "keep-me",
  PI_SESSION_ID: "sess-1",
};

const pids: number[] = [];

afterEach(() => {
  for (const pid of pids.splice(0)) killProcessTree(pid);
});

describe("filterPiBashEnv", () => {
  it("strips host identity and keeps OS, proxy, and PI session keys", () => {
    expect(filterPiBashEnv(HOST_ENV)).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/users/test",
      DISPLAY: ":0",
      HTTPS_PROXY: "http://proxy.example:8080",
      FOO_KEEP: "keep-me",
      PI_SESSION_ID: "sess-1",
    });
  });
});

describe("bashLogPath", () => {
  it("nests the log under the home logs directory, not the tool", () => {
    expect(bashLogPath("/tmp/pie-home", "sess/1", "12")).toBe(
      path.join(logsDirectory("/tmp/pie-home"), "bash", "sess_1", "12.log"),
    );
  });
});

describe("openBashLog", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bash-home-"));

  it("refuses a pre-existing or symlinked directory", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bash-outside-"));
    const planted = path.join(logsDirectory(home), "bash");
    fs.mkdirSync(logsDirectory(home), { mode: 0o700 });
    fs.symlinkSync(outside, planted);
    expect(() => openBashLog(home, bashLogPath(home, "sess", "1"))).toThrow(
      "refusing bash log path",
    );
    expect(fs.readdirSync(outside)).toEqual([]);

    fs.unlinkSync(planted);
    fs.mkdirSync(planted, { mode: 0o700 });
    const existing = bashLogPath(home, "sess", "2");
    fs.mkdirSync(path.dirname(existing), { mode: 0o700 });
    fs.writeFileSync(existing, "old");
    expect(() => openBashLog(home, existing)).toThrow("refusing bash log path");
    expect(fs.readFileSync(existing, "utf8")).toBe("old");
  });
});

describe("executePieBash", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bash-test-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bash-home-"));

  it("returns a short command and deletes its log", async () => {
    let logPath = "";
    const result = await executePieBash({
      command: "echo hello-pie",
      cwd,
      env: process.env,
      logRoot: home,
      logPath: (pid) => {
        logPath = bashLogPath(home, "test-short", String(pid));
        return logPath;
      },
    });
    expect(result.text).toContain("hello-pie");
    expect(result.text).not.toContain("background");
    await expect(fsPromises.access(logPath)).rejects.toThrow("ENOENT");
  });

  it("returns immediately when run_in_background is set and keeps the log", async () => {
    let settled: (message: string) => void = () => {};
    const notice = new Promise<string>((resolve) => {
      settled = resolve;
    });
    const result = await executePieBash({
      command: "printf 'flushed\\n'; sleep 30",
      cwd,
      env: process.env,
      yieldMs: 200,
      logRoot: home,
      logPath: (pid) => {
        pids.push(pid);
        return bashLogPath(home, "test-bg", String(pid));
      },
      onBackgroundExit: settled,
    });
    const pid = Number(result.text.match(/pid (\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(result.details?.fullOutputPath).toBe(bashLogPath(home, "test-bg", String(pid)));
    const written = await fsPromises.readFile(bashLogPath(home, "test-bg", String(pid)), "utf8");
    expect(written).toBe("flushed\n");
    killProcessTree(pid);
    const message = await notice;
    expect(message).toContain(`Background command ${pid}`);
    expect(message).toContain(bashLogPath(home, "test-bg", String(pid)));
  });

  it("keeps the log when the tool result is truncated", async () => {
    let logPath = "";
    const result = await executePieBash({
      command: "node -e \"process.stdout.write('x'.repeat(60000))\"",
      cwd,
      env: process.env,
      logRoot: home,
      logPath: (pid) => {
        logPath = bashLogPath(home, "test-trunc", String(pid));
        return logPath;
      },
    });
    expect(result.text).toContain("Truncated. Full output:");
    expect(result.details?.fullOutputPath).toBe(logPath);
    const full = await fsPromises.readFile(logPath);
    expect(full.length).toBeGreaterThan(50_000);
  });

  it("kills a running command when the turn is aborted", async () => {
    const controller = new AbortController();
    let pid = 0;
    const pending = executePieBash({
      command: "sleep 30",
      cwd,
      env: process.env,
      signal: controller.signal,
      yieldMs: 60_000,
      logRoot: home,
      logPath: (id) => {
        pid = id;
        return bashLogPath(home, "test-abort", String(id));
      },
    });
    controller.abort();
    await expect(pending).rejects.toThrow("Command aborted");
    expect(() => process.kill(pid, 0)).toThrow("ESRCH");
  });

  it("kills on timeout instead of backgrounding", async () => {
    await expect(
      executePieBash({
        command: "sleep 30",
        cwd,
        env: process.env,
        timeoutSeconds: 1,
        logRoot: home,
        logPath: (pid) => bashLogPath(home, "test-timeout", String(pid)),
      }),
    ).rejects.toThrow("Command timed out after 1 seconds");
  });
});
