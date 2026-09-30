import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { DESKTOP as desktopIdentity, WEB as webIdentity } from "../identity.ts";
import { writeRunMeta, type DesktopRunMeta, type WebRunMeta } from "../meta.ts";
import { agentBrowserIsolation } from "../runtime/browser.ts";
import { VerifyError } from "../runtime/fail.ts";
import { cliSurface } from "../surfaces/cli.ts";
import {
  browserEnvForRun,
  driveHintLines,
  parseEnvArgs,
  printEnv,
  resolveActiveBrowserEnv,
  rotateAutoRecordingForRun,
  teardownOwnedBrowserForRun,
  writeBrowserEnvFile,
  writeIsolationShim,
} from "./env.ts";

// Never overwrite a live operator's default Verify wrapper or evidence.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pie-env-tests-"));
const WEB = {
  ...webIdentity,
  root: path.join(testRoot, "web"),
  currentLink: path.join(testRoot, "web/current"),
  skillDir: path.join(testRoot, "web-skill"),
};
const DESKTOP = {
  ...desktopIdentity,
  root: path.join(testRoot, "desktop"),
  currentLink: path.join(testRoot, "desktop/current"),
  skillDir: path.join(testRoot, "desktop-skill"),
};
afterAll(() => fs.rmSync(testRoot, { recursive: true, force: true }));

function webMeta(): WebRunMeta {
  return {
    surface: "web",
    runId: "run-1",
    repo: "/repo",
    pieHome: "/tmp/pie-verify-web/runs/run-1/pie-home",
    piePort: 4180,
    vitePort: 4190,
    appUrl: "http://localhost:4190/",
    sampleProject: "/home/me/verify-pie-sample",
    createdSample: true,
    startedAt: "2026-09-01T00:00:00Z",
  };
}

function desktopMeta(): DesktopRunMeta {
  return {
    surface: "desktop",
    runId: "run-2",
    repo: "/repo",
    pieHome: "/tmp/pie-verify-desktop/runs/run-2/pie-home",
    piePort: 4000,
    startedAt: "2026-09-01T00:00:00Z",
    cdpPort: 9223,
    userData: "/tmp/pie-desktop-remote-debugging-9223",
    sampleProject: "/home/me/verify-pie-desktop-sample",
    createdSample: true,
  };
}

describe("parseEnvArgs", () => {
  it("defaults to plain KEY=value", () => {
    expect(parseEnvArgs([])).toEqual({ exportMode: false });
  });

  it("accepts --export", () => {
    expect(parseEnvArgs(["--export"])).toEqual({ exportMode: true });
  });

  it("rejects unknown flags", () => {
    expect(() => parseEnvArgs(["--json"])).toThrow(VerifyError);
  });
});

function withFakeBrowser<T>(fn: () => T): T {
  const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
  const previousChrome = process.env.VERIFY_PIE_CHROME;
  process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
  process.env.VERIFY_PIE_CHROME = "/tmp/fake-chrome";
  try {
    return fn();
  } finally {
    if (previousBin === undefined) {
      delete process.env.VERIFY_PIE_AGENT_BROWSER;
    } else {
      process.env.VERIFY_PIE_AGENT_BROWSER = previousBin;
    }
    if (previousChrome === undefined) {
      delete process.env.VERIFY_PIE_CHROME;
    } else {
      process.env.VERIFY_PIE_CHROME = previousChrome;
    }
  }
}

describe("browserEnvForRun", () => {
  it("exports the Vite origin and web isolation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    withFakeBrowser(() => {
      const isolation = agentBrowserIsolation(dir);
      expect(browserEnvForRun(WEB, dir)).toMatchObject({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_SESSION: WEB.browserSession,
        AGENT_BROWSER_NAMESPACE: WEB.browserSession,
        AGENT_BROWSER_CONFIG: isolation.configPath,
        AGENT_BROWSER_SOCKET_DIR: isolation.socketDir,
        AGENT_BROWSER_EXECUTABLE_PATH: "/tmp/fake-chrome",
        AGENT_BROWSER_ARGS: "--no-sandbox,--disable-dev-shm-usage",
        PIE_VERIFY_APP_URL: "http://localhost:4190/",
        PIE_VERIFY_RECORDING_PATH: path.join(WEB.skillDir, "evidence/run-1/recording-001.webm"),
      });
    });
  });

  it("exports desktop CDP and session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), desktopMeta());
    withFakeBrowser(() => {
      expect(browserEnvForRun(DESKTOP, dir)).toMatchObject({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_SESSION: DESKTOP.browserSession,
        AGENT_BROWSER_NAMESPACE: DESKTOP.browserSession,
        AGENT_BROWSER_CDP: "9223",
        AGENT_BROWSER_PIN_TAB: "true",
        PIE_VERIFY_RECORDING_PATH: path.join(DESKTOP.skillDir, "evidence/run-2/recording-001.webm"),
      });
      expect(browserEnvForRun(DESKTOP, dir).AGENT_BROWSER_ARGS).toBeUndefined();
    });
  });

  it("refuses the CLI surface", () => {
    expect(() => browserEnvForRun(cliSurface.identity, "/tmp")).toThrow(/no browser/);
  });
});

describe("rotateAutoRecordingForRun", () => {
  it("keeps the first unused name and advances past completed recordings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-recording-sequence-"));
    const command = path.join(dir, "bin/agent-browser");
    const trace = path.join(dir, "trace");
    const identity = {
      ...DESKTOP,
      root: path.join(dir, "root"),
      currentLink: path.join(dir, "root/current"),
      skillDir: path.join(dir, "skill"),
    };
    writeRunMeta(path.join(dir, "meta.json"), desktopMeta());
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\n`, {
      mode: 0o755,
    });
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = command;
    try {
      const first = browserEnvForRun(identity, dir).PIE_VERIFY_RECORDING_PATH;
      if (first === undefined) throw new Error("missing recording path");
      expect(path.basename(first)).toBe("recording-001.webm");
      rotateAutoRecordingForRun(identity, dir);
      expect(fs.existsSync(trace)).toBe(false);

      fs.mkdirSync(path.dirname(first), { recursive: true });
      fs.writeFileSync(first, "video");
      rotateAutoRecordingForRun(identity, dir);
      const second = browserEnvForRun(identity, dir).PIE_VERIFY_RECORDING_PATH;
      if (second === undefined) throw new Error("missing recording path");
      expect(path.basename(second)).toBe("recording-002.webm");
      fs.writeFileSync(second, "video");
      rotateAutoRecordingForRun(identity, dir);
      const third = browserEnvForRun(identity, dir).PIE_VERIFY_RECORDING_PATH;
      if (third === undefined) throw new Error("missing recording path");
      expect(path.basename(third)).toBe("recording-003.webm");
      expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual([
        "record stop",
        "record stop",
      ]);
    } finally {
      if (previous === undefined) delete process.env.VERIFY_PIE_AGENT_BROWSER;
      else process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      fs.rmSync(agentBrowserIsolation(dir).socketDir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("teardownOwnedBrowserForRun", () => {
  it("always closes, even with no recording file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-teardown-"));
    const command = path.join(dir, "bin/agent-browser");
    const trace = path.join(dir, "trace");
    const identity = {
      ...WEB,
      root: path.join(dir, "root"),
      currentLink: path.join(dir, "root/current"),
      skillDir: path.join(dir, "skill"),
    };
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\n`, {
      mode: 0o755,
    });
    const previousBin = process.env.VERIFY_PIE_AGENT_BROWSER;
    const previousChrome = process.env.VERIFY_PIE_CHROME;
    process.env.VERIFY_PIE_AGENT_BROWSER = command;
    process.env.VERIFY_PIE_CHROME = "/tmp/fake-chrome";
    try {
      await teardownOwnedBrowserForRun(identity, dir);
      expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual(["close"]);

      const recording = browserEnvForRun(identity, dir).PIE_VERIFY_RECORDING_PATH;
      if (recording === undefined) throw new Error("missing recording path");
      fs.mkdirSync(path.dirname(recording), { recursive: true });
      fs.writeFileSync(recording, "video");
      await teardownOwnedBrowserForRun(identity, dir);
      expect(fs.readFileSync(trace, "utf8").trim().split("\n")).toEqual([
        "close",
        "record stop",
        "close",
      ]);
    } finally {
      if (previousBin === undefined) delete process.env.VERIFY_PIE_AGENT_BROWSER;
      else process.env.VERIFY_PIE_AGENT_BROWSER = previousBin;
      if (previousChrome === undefined) delete process.env.VERIFY_PIE_CHROME;
      else process.env.VERIFY_PIE_CHROME = previousChrome;
      fs.rmSync(agentBrowserIsolation(dir).socketDir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeBrowserEnvFile", () => {
  it("writes export lines and config next to meta.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    const isolation = agentBrowserIsolation(dir);
    try {
      withFakeBrowser(() => {
        writeBrowserEnvFile(WEB, dir);
        const text = fs.readFileSync(path.join(dir, "agent-browser.env"), "utf8");
        expect(text).toContain("export AGENT_BROWSER='/tmp/fake-agent-browser'");
        expect(text).toContain(`export AGENT_BROWSER_SESSION='${WEB.browserSession}'`);
        expect(text).toContain(`export AGENT_BROWSER_NAMESPACE='${WEB.browserSession}'`);
        expect(text).toContain("export PIE_VERIFY_APP_URL='http://localhost:4190/'");
        expect(text).toContain("export PIE_VERIFY_RECORDING_PATH=");
        expect(text).toContain("unset AGENT_BROWSER_AUTO_CONNECT");
        expect(text).toContain("unset AGENT_BROWSER_HEADED");
        expect(text).toContain("unset AGENT_BROWSER_CDP");
        const config = JSON.parse(
          fs.readFileSync(path.join(dir, "agent-browser.json"), "utf8"),
        ) as {
          session: string;
          headed: boolean;
          idleTimeout: string;
        };
        expect(config.session).toBe(WEB.browserSession);
        expect(config.headed).toBe(false);
        expect(config.idleTimeout).toBe("0");
        expect(fs.existsSync(path.join(dir, "agent-browser/screenshots"))).toBe(true);
        expect(fs.existsSync(path.join(WEB.skillDir, "evidence/run-1"))).toBe(true);
        expect(text).toContain(`export AGENT_BROWSER_SOCKET_DIR='${isolation.socketDir}'`);
        expect(isolation.socketDir.startsWith("/tmp/pvs-")).toBe(true);
      });
    } finally {
      fs.rmSync(isolation.socketDir, { recursive: true, force: true });
      fs.rmSync(path.join(WEB.skillDir, "evidence/run-1"), { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips the CLI surface", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeBrowserEnvFile(cliSurface.identity, dir);
    expect(fs.existsSync(path.join(dir, "agent-browser.env"))).toBe(false);
  });
});

describe("resolveActiveBrowserEnv", () => {
  it("uses the only current surface", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    withFakeBrowser(() => {
      expect(resolveActiveBrowserEnv({ webRun: dir, desktopRun: undefined })).toMatchObject({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_SESSION: WEB.browserSession,
        PIE_VERIFY_APP_URL: "http://localhost:4190/",
      });
    });
  });

  it("refuses when both surfaces are current", () => {
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(webDir, "meta.json"), webMeta());
    writeRunMeta(path.join(desktopDir, "meta.json"), desktopMeta());
    expect(() => resolveActiveBrowserEnv({ webRun: webDir, desktopRun: desktopDir })).toThrow(
      /both current/,
    );
  });

  it("honors PIE_VERIFY_SURFACE when both runs exist", () => {
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(webDir, "meta.json"), webMeta());
    writeRunMeta(path.join(desktopDir, "meta.json"), desktopMeta());
    withFakeBrowser(() => {
      expect(
        resolveActiveBrowserEnv({
          surface: "desktop",
          webRun: webDir,
          desktopRun: desktopDir,
        }),
      ).toMatchObject({
        AGENT_BROWSER_SESSION: DESKTOP.browserSession,
        AGENT_BROWSER_CDP: "9223",
        AGENT_BROWSER_PIN_TAB: "true",
      });
    });
  });

  it("passes through when no verify run is current", () => {
    expect(resolveActiveBrowserEnv({ webRun: undefined, desktopRun: undefined })).toBeUndefined();
  });
});

describe("writeIsolationShim", () => {
  it.each([WEB, DESKTOP])("binds $id even with a foreign ambient root/session", (base) => {
    const root = fs.mkdtempSync(path.join(testRoot, `${base.id}-$quoted-`));
    const identity = {
      ...base,
      root,
      currentLink: path.join(root, "current"),
      skillDir: path.join(root, "skill"),
    };
    const run = path.join(root, "runs", "bound");
    writeRunMeta(path.join(run, "meta.json"), base.id === "web" ? webMeta() : desktopMeta());
    fs.symlinkSync(run, identity.currentLink);
    const bin = path.join(root, "fake-browser");
    fs.writeFileSync(
      bin,
      '#!/bin/sh\nprintf "%s\\n" "$AGENT_BROWSER_SOCKET_DIR" "$PIE_VERIFY_RECORDING_PATH" "$AGENT_BROWSER_SESSION"\n',
      { mode: 0o755 },
    );
    withFakeBrowser(() => {
      process.env.VERIFY_PIE_AGENT_BROWSER = bin;
      writeBrowserEnvFile(identity, run);
      const result = childProcess.spawnSync(path.join(root, "bin/agent-browser"), ["--version"], {
        encoding: "utf8",
        env: {
          ...process.env,
          VERIFY_PIE_ROOT: path.join(testRoot, "foreign"),
          VERIFY_PIE_DESKTOP_ROOT: path.join(testRoot, "foreign"),
          VERIFY_PIE_BROWSER_SESSION: "foreign",
          VERIFY_PIE_DESKTOP_BROWSER_SESSION: "foreign",
        },
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual([
        agentBrowserIsolation(run).socketDir,
        browserEnvForRun(identity, run).PIE_VERIFY_RECORDING_PATH,
        identity.browserSession,
      ]);
    });
    fs.rmSync(agentBrowserIsolation(run).socketDir, { recursive: true, force: true });
  });

  it("writes a sourced wrapper under the isolation root", () => {
    writeIsolationShim(WEB);
    const dest = path.join(WEB.root, "bin/agent-browser");
    const text = fs.readFileSync(dest, "utf8");
    expect(text).toContain(path.join(WEB.currentLink, "agent-browser.env"));
    expect(text).toContain("export PIE_VERIFY_SURFACE=web");
    expect(text).toContain(`export VERIFY_PIE_ROOT='${WEB.root}'`);
    expect(text).toContain(`export VERIFY_PIE_SKILL_DIR='${WEB.skillDir}'`);
    expect(text).toContain(`export VERIFY_PIE_BROWSER_SESSION='${WEB.browserSession}'`);
    expect(text).toContain('export VERIFY_PIE_AGENT_BROWSER="$AGENT_BROWSER"');
    expect(text).toContain("tools/verify/bin/agent-browser");
    expect(fs.statSync(dest).mode & 0o111).not.toBe(0);
  });
});

describe("driveHintLines", () => {
  it("teaches bare agent-browser for web", () => {
    const lines = driveHintLines(WEB);
    expect(lines.some((line) => line.includes("agent-browser open http://localhost:4190/"))).toBe(
      true,
    );
  });

  it("uses the configured web port", () => {
    expect(driveHintLines({ ...WEB, vitePort: 4194 }).join("\n")).toContain(
      "http://localhost:4194/",
    );
  });

  it("teaches bare agent-browser for desktop", () => {
    const lines = driveHintLines(DESKTOP);
    expect(lines.some((line) => line.includes("agent-browser get title"))).toBe(true);
  });
});

describe("printEnv", () => {
  it("refuses the CLI surface", () => {
    expect(() => printEnv(cliSurface, [])).toThrow(/no browser/);
  });
});
