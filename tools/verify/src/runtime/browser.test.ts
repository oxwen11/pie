import { describe, expect, it } from "vitest";

import { buildAgentBrowserArgv } from "./browser.ts";

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

  it("opens the Vite origin when web open has no URL", () => {
    expect(
      buildAgentBrowserArgv(["open"], {
        session: "pie-verify-web",
        defaultOpenUrl: "http://localhost:4190/",
      }),
    ).toEqual(["--session", "pie-verify-web", "open", "http://localhost:4190/"]);
  });

  it("keeps an explicit open URL", () => {
    expect(
      buildAgentBrowserArgv(["open", "http://localhost:4190/draft"], {
        session: "pie-verify-web",
        defaultOpenUrl: "http://localhost:4190/",
      }),
    ).toEqual(["--session", "pie-verify-web", "open", "http://localhost:4190/draft"]);
  });
});
