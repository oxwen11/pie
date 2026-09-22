import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { killProcessTree } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  bashLogPath,
  bashSpawnEnv,
  executePieBash,
  filterPiBashEnv,
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

describe("bashSpawnEnv", () => {
  it("rewrites the five PI session keys and still strips Pie identity", () => {
    expect(
      bashSpawnEnv(HOST_ENV, {
        sessionId: "sess-2",
        sessionFile: "/tmp/session.jsonl",
        provider: "anthropic",
        modelId: "claude",
        reasoning: "high",
      }),
    ).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/users/test",
      DISPLAY: ":0",
      HTTPS_PROXY: "http://proxy.example:8080",
      FOO_KEEP: "keep-me",
      PI_SESSION_ID: "sess-2",
      PI_SESSION_FILE: "/tmp/session.jsonl",
      PI_PROVIDER: "anthropic",
      PI_MODEL: "claude",
      PI_REASONING_LEVEL: "high",
    });
  });
});

describe("bashLogPath", () => {
  it("nests the log under the session, not the tool", () => {
    expect(bashLogPath("sess/1", "12")).toBe(
      path.join(os.tmpdir(), "pie", "sess_1", "bash", "12.log"),
    );
  });
});

describe("executePieBash", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bash-test-"));

  it("returns a short command and deletes its log", async () => {
    let logPath = "";
    const result = await executePieBash({
      command: "echo hello-pie",
      cwd,
      env: process.env,
      logPath: (pid) => {
        logPath = bashLogPath("test-short", String(pid));
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
      logPath: (pid) => {
        pids.push(pid);
        return bashLogPath("test-bg", String(pid));
      },
      onBackgroundExit: settled,
    });
    const pid = Number(result.text.match(/pid (\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(result.details?.fullOutputPath).toBe(bashLogPath("test-bg", String(pid)));
    const written = await fsPromises.readFile(bashLogPath("test-bg", String(pid)), "utf8");
    expect(written).toBe("flushed\n");
    killProcessTree(pid);
    const message = await notice;
    expect(message).toContain(`Background command ${pid}`);
    expect(message).toContain(bashLogPath("test-bg", String(pid)));
  });

  it("keeps the log when the tool result is truncated", async () => {
    let logPath = "";
    const result = await executePieBash({
      command: "node -e \"process.stdout.write('x'.repeat(60000))\"",
      cwd,
      env: process.env,
      logPath: (pid) => {
        logPath = bashLogPath("test-trunc", String(pid));
        return logPath;
      },
    });
    expect(result.text).toContain("Truncated. Full output:");
    expect(result.details?.fullOutputPath).toBe(logPath);
    const full = await fsPromises.readFile(logPath);
    expect(full.length).toBeGreaterThan(50_000);
  });

  it("aborts a running command instead of backgrounding it", async () => {
    const controller = new AbortController();
    const pending = executePieBash({
      command: "sleep 30",
      cwd,
      env: process.env,
      signal: controller.signal,
      yieldMs: 60_000,
      logPath: (pid) => bashLogPath("test-abort", String(pid)),
    });
    controller.abort();
    await expect(pending).rejects.toThrow("Command aborted");
  });

  it("kills on timeout instead of backgrounding", async () => {
    await expect(
      executePieBash({
        command: "sleep 30",
        cwd,
        env: process.env,
        timeoutSeconds: 1,
        logPath: (pid) => bashLogPath("test-timeout", String(pid)),
      }),
    ).rejects.toThrow("Command timed out after 1 seconds");
  });
});
