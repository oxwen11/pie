import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_BROWSER_UNIX_SOCKET_MAX,
  agentBrowserDaemonPidPath,
  agentBrowserDaemonSocketPath,
  agentBrowserIsolation,
  applyBrowserEnv,
  browserConfigForEnv,
  browserNeedsIsolation,
  buildAgentBrowserArgv,
  ensureAutoRecording,
  formatBrowserEnv,
  isManagedAgentBrowserSocketDir,
  resolveAgentBrowserBin,
  resolveBrowserEnv,
  resolveIsolatedChromeExecutable,
  shortAgentBrowserSocketDir,
  stopAutoRecording,
  teardownOwnedBrowser,
} from "./browser.ts";
import { pidAlive } from "./process.ts";

describe("buildAgentBrowserArgv", () => {
  it("injects the isolated session name", () => {
    expect(buildAgentBrowserArgv(["snapshot"], { session: "pie-verify-web" })).toEqual([
      "--session",
      "pie-verify-web",
      "snapshot",
    ]);
  });

  it("injects desktop CDP and session together", () => {
    expect(
      buildAgentBrowserArgv(["snapshot"], { session: "pie-verify-desktop", cdpPort: 9223 }),
    ).toEqual(["--session", "pie-verify-desktop", "--cdp", "9223", "snapshot"]);
  });

  it("forwards open unchanged when no URL is given", () => {
    expect(buildAgentBrowserArgv(["open"], { session: "pie-verify-web" })).toEqual([
      "--session",
      "pie-verify-web",
      "open",
    ]);
  });

  it("keeps an explicit open URL", () => {
    expect(
      buildAgentBrowserArgv(["open", "http://localhost:4190/draft"], {
        session: "pie-verify-web",
      }),
    ).toEqual(["--session", "pie-verify-web", "open", "http://localhost:4190/draft"]);
  });

  it("does not inject isolation for install and skills", () => {
    expect(browserNeedsIsolation("install")).toBe(false);
    expect(browserNeedsIsolation("skills")).toBe(false);
    expect(buildAgentBrowserArgv(["install"], { session: "pie-verify-web" })).toEqual(["install"]);
    expect(buildAgentBrowserArgv(["skills", "get", "core"], { session: "pie-verify-web" })).toEqual(
      ["skills", "get", "core"],
    );
  });
});

describe("automatic recording", () => {
  it("starts at 60 fps, tolerates an active take, and stops it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-recording-"));
    const command = path.join(dir, "agent-browser");
    const trace = path.join(dir, "trace");
    const output = path.join(dir, "recording.webm");
    fs.writeFileSync(
      command,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$TRACE"
if [ "$FAIL_ACTIVE" = 1 ]; then
  echo 'Recording already active' >&2
  exit 1
fi
`,
      { mode: 0o755 },
    );
    const env = { ...process.env, TRACE: trace, PIE_VERIFY_RECORDING_PATH: output };
    const target = { session: "pie-verify-desktop", cdpPort: 9223 };

    ensureAutoRecording(command, target, env);
    ensureAutoRecording(command, target, { ...env, FAIL_ACTIVE: "1" });
    fs.writeFileSync(output, "video");
    expect(stopAutoRecording(command, target, env)).toBeUndefined();

    expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      `--session pie-verify-desktop --cdp 9223 record start ${output} --fps 60`,
      `--session pie-verify-desktop --cdp 9223 record start ${output} --fps 60`,
      "--session pie-verify-desktop --cdp 9223 record stop",
    ]);
  });
});

describe("teardownOwnedBrowser", () => {
  it("always closes after an optional record stop and kills a leftover daemon", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-teardown-"));
    const command = path.join(dir, "agent-browser");
    const trace = path.join(dir, "trace");
    const recording = path.join(dir, "recording.webm");
    const socketDir = path.join(dir, "sockets");
    const session = "pie-verify-web";
    const pidPath = agentBrowserDaemonPidPath(socketDir, session);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(
      command,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$TRACE"
`,
      { mode: 0o755 },
    );
    const child = path.join(dir, "linger.sh");
    fs.writeFileSync(child, "#!/bin/sh\nwhile true; do sleep 30; done\n", { mode: 0o755 });
    const proc = childProcess.spawn(child, [], { stdio: "ignore", detached: true });
    proc.unref();
    if (proc.pid === undefined) throw new Error("missing pid");
    const pid = proc.pid;
    fs.writeFileSync(pidPath, `${String(pid)}\n`);
    fs.writeFileSync(recording, "video");
    const env = { ...process.env, TRACE: trace, PIE_VERIFY_RECORDING_PATH: recording };
    try {
      expect(pidAlive(pid)).toBe(true);
      await expect(teardownOwnedBrowser(command, env, { socketDir, session })).resolves.toEqual([]);
      expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual(["record stop", "close"]);
      expect(pidAlive(pid)).toBe(false);
      await expect(
        teardownOwnedBrowser(command, { ...process.env, TRACE: trace }, { socketDir, session }),
      ).resolves.toEqual([]);
      expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual([
        "record stop",
        "close",
        "close",
      ]);
    } finally {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAgentBrowserBin", () => {
  it("prefers VERIFY_PIE_AGENT_BROWSER", () => {
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      expect(resolveAgentBrowserBin()).toBe("/tmp/fake-agent-browser");
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_AGENT_BROWSER;
      } else {
        process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      }
    }
  });

  it("resolves the mise-managed agent-browser", () => {
    const resolved = resolveAgentBrowserBin();
    expect(resolved).toMatch(/agent-browser/);
  });
});

describe("shortAgentBrowserSocketDir", () => {
  it("keeps the daemon socket under the Unix sun_path limit for a real run dir", () => {
    const runDir = "/tmp/pie-verify-web/runs/20260902T112638Z-63968";
    const socketDir = shortAgentBrowserSocketDir(runDir);
    expect(socketDir).toMatch(/^\/tmp\/pvs-[0-9a-f]{8}$/);
    expect(isManagedAgentBrowserSocketDir(socketDir)).toBe(true);
    expect(
      agentBrowserDaemonSocketPath(socketDir, "pie-verify-desktop").length,
    ).toBeLessThanOrEqual(AGENT_BROWSER_UNIX_SOCKET_MAX);
    expect(
      agentBrowserDaemonSocketPath(path.join(runDir, "agent-browser/sockets"), "pie-verify-web")
        .length,
    ).toBeGreaterThan(AGENT_BROWSER_UNIX_SOCKET_MAX);
  });

  it("stays short when the isolation root is long", () => {
    const runDir = `/tmp/${"pie-verify-isolation-".repeat(8)}/runs/20260902T112638Z-1`;
    const socketDir = shortAgentBrowserSocketDir(runDir);
    expect(socketDir.startsWith("/tmp/pvs-")).toBe(true);
    expect(
      agentBrowserDaemonSocketPath(socketDir, "pie-verify-desktop").length,
    ).toBeLessThanOrEqual(AGENT_BROWSER_UNIX_SOCKET_MAX);
  });

  it("is stable for the same run dir and honors VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR", () => {
    const runDir = "/tmp/pie-verify-web/runs/run-1";
    expect(shortAgentBrowserSocketDir(runDir)).toBe(shortAgentBrowserSocketDir(runDir));
    expect(shortAgentBrowserSocketDir(runDir)).not.toBe(
      shortAgentBrowserSocketDir("/tmp/pie-verify-desktop/runs/run-1"),
    );
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR;
    process.env.VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR = "/tmp/pvw-s";
    try {
      expect(shortAgentBrowserSocketDir(runDir)).toBe("/tmp/pvw-s");
      expect(isManagedAgentBrowserSocketDir("/tmp/pvw-s")).toBe(false);
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR", previous);
    }
  });
});

describe("resolveBrowserEnv", () => {
  it("pins web screenshots under the run dir, sockets under /tmp/pvs-*, and skips CDP", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const isolation = agentBrowserIsolation(runDir);
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousChrome = process.env.VERIFY_PIE_CHROME;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    process.env.VERIFY_PIE_CHROME = "/tmp/fake-chrome";
    try {
      const resolved = resolveBrowserEnv({
        session: "pie-verify-web",
        appUrl: "http://localhost:4190/",
        recordingPath: path.join(runDir, "recording.webm"),
        runDir,
      });
      expect(resolved).toEqual({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_CONFIG: isolation.configPath,
        AGENT_BROWSER_SESSION: "pie-verify-web",
        AGENT_BROWSER_NAMESPACE: "pie-verify-web",
        AGENT_BROWSER_SOCKET_DIR: isolation.socketDir,
        AGENT_BROWSER_EXECUTABLE_PATH: "/tmp/fake-chrome",
        AGENT_BROWSER_ARGS: "--no-sandbox,--disable-dev-shm-usage",
        AGENT_BROWSER_SCREENSHOT_DIR: isolation.screenshotDir,
        AGENT_BROWSER_DOWNLOAD_PATH: isolation.downloadPath,
        AGENT_BROWSER_IDLE_TIMEOUT_MS: "0",
        AGENT_BROWSER_DEFAULT_TIMEOUT: "40000",
        PIE_VERIFY_APP_URL: "http://localhost:4190/",
        PIE_VERIFY_RECORDING_PATH: path.join(runDir, "recording.webm"),
      });
      expect(resolved.AGENT_BROWSER_SOCKET_DIR.startsWith(runDir)).toBe(false);
      expect(resolved.AGENT_BROWSER_SCREENSHOT_DIR.startsWith(runDir)).toBe(true);
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previousBin);
      restoreEnv("VERIFY_PIE_CHROME", previousChrome);
    }
  });

  it("pins desktop CDP and does not launch Chrome", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const isolation = agentBrowserIsolation(runDir);
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousChrome = process.env.VERIFY_PIE_CHROME;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    process.env.VERIFY_PIE_CHROME = "/tmp/fake-chrome";
    try {
      const resolved = resolveBrowserEnv({
        session: "pie-verify-desktop",
        cdpPort: 9223,
        runDir,
      });
      expect(resolved.AGENT_BROWSER_CDP).toBe("9223");
      expect(resolved.AGENT_BROWSER_PIN_TAB).toBe("true");
      expect(resolved.AGENT_BROWSER_SOCKET_DIR).toBe(isolation.socketDir);
      expect(resolved.AGENT_BROWSER_EXECUTABLE_PATH).toBeUndefined();
      expect(resolved.AGENT_BROWSER_ARGS).toBeUndefined();
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previousBin);
      restoreEnv("VERIFY_PIE_CHROME", previousChrome);
    }
  });

  it("refuses a socket dir that would overflow Unix sun_path", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousSocket = process.env.VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    process.env.VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR =
      "/tmp/pie-verify-web/runs/20260902T112638Z-63968/agent-browser/sockets";
    try {
      expect(() => resolveBrowserEnv({ session: "pie-verify-web", runDir })).toThrow(
        /socket path is \d+ bytes/,
      );
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previousBin);
      restoreEnv("VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR", previousSocket);
    }
  });
});

describe("browserConfigForEnv", () => {
  it("keeps cdp and timeouts as strings", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      const config = browserConfigForEnv(
        resolveBrowserEnv({ session: "pie-verify-desktop", cdpPort: 9223, runDir }),
      );
      expect(config.cdp).toBe("9223");
      expect(config.headed).toBe(false);
      expect(config.idleTimeout).toBe("0");
      expect(config.timeout).toBe("40000");
      expect(config.pinTab).toBe(true);
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previous);
    }
  });

  it("requires a Verify-specific opt-in for a visible browser", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousHeaded = process.env.PIE_VERIFY_BROWSER_HEADED;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    process.env.PIE_VERIFY_BROWSER_HEADED = "1";
    try {
      const config = browserConfigForEnv(
        resolveBrowserEnv({ session: "pie-verify-web", appUrl: "http://localhost:4190/", runDir }),
      );
      expect(config.headed).toBe(true);
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previousBin);
      restoreEnv("PIE_VERIFY_BROWSER_HEADED", previousHeaded);
    }
  });
});

describe("applyBrowserEnv", () => {
  it("drops desktop CDP when applying a web run", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      const env: NodeJS.ProcessEnv = {
        AGENT_BROWSER_CDP: "9223",
        AGENT_BROWSER_PIN_TAB: "true",
        AGENT_BROWSER_AUTO_CONNECT: "1",
        AGENT_BROWSER_HEADED: "1",
        AGENT_BROWSER_PROFILE: "/tmp/user-chrome",
      };
      applyBrowserEnv(
        resolveBrowserEnv({ session: "pie-verify-web", appUrl: "http://localhost:4190/", runDir }),
        env,
      );
      expect(env.AGENT_BROWSER_SESSION).toBe("pie-verify-web");
      expect(env.AGENT_BROWSER_CDP).toBeUndefined();
      expect(env.AGENT_BROWSER_PIN_TAB).toBeUndefined();
      expect(env.AGENT_BROWSER_AUTO_CONNECT).toBeUndefined();
      expect(env.AGENT_BROWSER_HEADED).toBeUndefined();
      expect(env.AGENT_BROWSER_PROFILE).toBeUndefined();
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previous);
    }
  });
});

describe("resolveIsolatedChromeExecutable", () => {
  it("prefers VERIFY_PIE_CHROME", () => {
    const previous = process.env.VERIFY_PIE_CHROME;
    process.env.VERIFY_PIE_CHROME = "/tmp/override-chrome";
    try {
      expect(resolveIsolatedChromeExecutable()).toBe("/tmp/override-chrome");
    } finally {
      restoreEnv("VERIFY_PIE_CHROME", previous);
    }
  });

  it("does not pick the /usr/local/bin debug wrapper", () => {
    const previous = process.env.VERIFY_PIE_CHROME;
    delete process.env.VERIFY_PIE_CHROME;
    try {
      expect(resolveIsolatedChromeExecutable()).not.toBe("/usr/local/bin/google-chrome");
    } finally {
      restoreEnv("VERIFY_PIE_CHROME", previous);
    }
  });
});

describe("formatBrowserEnv", () => {
  it("prints plain KEY=value and quoted export lines", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-browser-"));
    const isolation = agentBrowserIsolation(runDir);
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousChrome = process.env.VERIFY_PIE_CHROME;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    process.env.VERIFY_PIE_CHROME = "/tmp/fake-chrome";
    try {
      const resolved = resolveBrowserEnv({
        session: "pie-verify-web",
        appUrl: "http://localhost:4190/",
        runDir,
      });
      const plain = formatBrowserEnv(resolved, "plain");
      expect(plain).toContain("AGENT_BROWSER=/tmp/fake-agent-browser");
      expect(plain).toContain("AGENT_BROWSER_SESSION=pie-verify-web");
      expect(plain).toContain("AGENT_BROWSER_NAMESPACE=pie-verify-web");
      expect(plain).toContain(`AGENT_BROWSER_SOCKET_DIR=${isolation.socketDir}`);
      expect(plain).toContain("PIE_VERIFY_APP_URL=http://localhost:4190/");
      const exported = formatBrowserEnv(resolved, "export");
      expect(exported).toContain("unset AGENT_BROWSER_AUTO_CONNECT");
      expect(exported).toContain("unset AGENT_BROWSER_CDP");
      expect(exported).toContain("export AGENT_BROWSER_SESSION='pie-verify-web'");
      expect(exported).toContain("export PIE_VERIFY_APP_URL='http://localhost:4190/'");
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previousBin);
      restoreEnv("VERIFY_PIE_CHROME", previousChrome);
    }
  });
});

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = previous;
  }
}
