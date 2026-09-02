import { describe, expect, it } from "vitest";

import {
  browserNeedsIsolation,
  buildAgentBrowserArgv,
  formatBrowserEnv,
  resolveAgentBrowserBin,
  resolveBrowserEnv,
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

describe("formatBrowserEnv", () => {
  it("prints plain KEY=value and quoted export lines", () => {
    const previous = process.env.VERIFY_PIE_AGENT_BROWSER;
    process.env.VERIFY_PIE_AGENT_BROWSER = "/tmp/fake-agent-browser";
    try {
      const resolved = resolveBrowserEnv({
        session: "pie-verify-web",
        appUrl: "http://localhost:4190/",
      });
      expect(formatBrowserEnv(resolved, "plain")).toBe(
        [
          "AGENT_BROWSER=/tmp/fake-agent-browser",
          "AGENT_BROWSER_SESSION=pie-verify-web",
          "PIE_VERIFY_APP_URL=http://localhost:4190/",
          "",
        ].join("\n"),
      );
      expect(formatBrowserEnv(resolved, "export")).toBe(
        [
          "export AGENT_BROWSER='/tmp/fake-agent-browser'",
          "export AGENT_BROWSER_SESSION='pie-verify-web'",
          "export PIE_VERIFY_APP_URL='http://localhost:4190/'",
          "",
        ].join("\n"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_AGENT_BROWSER;
      } else {
        process.env.VERIFY_PIE_AGENT_BROWSER = previous;
      }
    }
  });
});
