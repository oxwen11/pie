import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_BROWSER_UNIX_SOCKET_MAX,
  agentBrowserDaemonSocketPath,
  agentBrowserIsolation,
  applyBrowserEnv,
  browserConfigForEnv,
  browserNeedsIsolation,
  buildAgentBrowserArgv,
  formatBrowserEnv,
  isManagedAgentBrowserSocketDir,
  resolveAgentBrowserBin,
  resolveBrowserEnv,
  resolveIsolatedChromeExecutable,
  shortAgentBrowserSocketDir,
} from "./browser.ts";

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
      expect(config.idleTimeout).toBe("0");
      expect(config.timeout).toBe("40000");
      expect(config.pinTab).toBe(true);
    } finally {
      restoreEnv("VERIFY_PIE_AGENT_BROWSER", previous);
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
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
