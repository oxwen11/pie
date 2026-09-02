import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DESKTOP, WEB } from "../identity.ts";
import { writeRunMeta, type DesktopRunMeta, type WebRunMeta } from "../meta.ts";
import { VerifyError } from "../runtime/fail.ts";
import { cliSurface } from "../surfaces/cli.ts";
import {
  browserEnvForRun,
  driveHintLines,
  parseEnvArgs,
  printEnv,
  writeBrowserEnvFile,
} from "./env.ts";

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
    daemonDir: "/tmp/pie-verify-desktop/runs/run-2/pie-home/daemon",
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

describe("browserEnvForRun", () => {
  it("exports the Vite origin and web session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      expect(browserEnvForRun(WEB, dir)).toEqual({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_SESSION: WEB.browserSession,
        PIE_VERIFY_APP_URL: "http://localhost:4190/",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_AGENT_BROWSER;
      } else {
        process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      }
    }
  });

  it("exports desktop CDP and session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), desktopMeta());
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      expect(browserEnvForRun(DESKTOP, dir)).toEqual({
        AGENT_BROWSER: "/tmp/fake-agent-browser",
        AGENT_BROWSER_SESSION: DESKTOP.browserSession,
        AGENT_BROWSER_CDP: "9223",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_AGENT_BROWSER;
      } else {
        process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      }
    }
  });

  it("refuses the CLI surface", () => {
    expect(() => browserEnvForRun(cliSurface.identity, "/tmp")).toThrow(/no browser/);
  });
});

describe("writeBrowserEnvFile", () => {
  it("writes export lines next to meta.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeRunMeta(path.join(dir, "meta.json"), webMeta());
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      writeBrowserEnvFile(WEB, dir);
      const text = fs.readFileSync(path.join(dir, "agent-browser.env"), "utf8");
      expect(text).toContain("export AGENT_BROWSER='/tmp/fake-agent-browser'");
      expect(text).toContain(`export AGENT_BROWSER_SESSION='${WEB.browserSession}'`);
      expect(text).toContain("export PIE_VERIFY_APP_URL='http://localhost:4190/'");
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_AGENT_BROWSER;
      } else {
        process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      }
    }
  });

  it("skips the CLI surface", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-env-"));
    writeBrowserEnvFile(cliSurface.identity, dir);
    expect(fs.existsSync(path.join(dir, "agent-browser.env"))).toBe(false);
  });
});

describe("driveHintLines", () => {
  it("teaches eval + open for web", () => {
    const lines = driveHintLines(WEB);
    expect(lines.some((line) => line.includes("env --export"))).toBe(true);
    expect(lines.some((line) => line.includes('open "$PIE_VERIFY_APP_URL"'))).toBe(true);
  });

  it("teaches eval + connect for desktop", () => {
    const lines = driveHintLines(DESKTOP);
    expect(lines.some((line) => line.includes('connect "$AGENT_BROWSER_CDP"'))).toBe(true);
  });
});

describe("printEnv", () => {
  it("refuses the CLI surface", () => {
    expect(() => printEnv(cliSurface, [])).toThrow(/no browser/);
  });
});
