import { describe, expect, it } from "vitest";

import {
  buildTailscaleHttpsBaseUrl,
  DEFAULT_TAILSCALE_SERVE_PORT,
  tailscaleServeDisableArgs,
  tailscaleServeEnableArgs,
} from "./serve";

describe("tailscale serve args", () => {
  it("forwards loopback over background HTTPS Serve", () => {
    expect(tailscaleServeEnableArgs({ localPort: 41234 })).toEqual([
      "serve",
      "--bg",
      `--https=${DEFAULT_TAILSCALE_SERVE_PORT}`,
      "http://127.0.0.1:41234",
    ]);
  });

  it("turns Serve off without logging secrets", () => {
    expect(tailscaleServeDisableArgs()).toEqual([
      "serve",
      `--https=${DEFAULT_TAILSCALE_SERVE_PORT}`,
      "off",
    ]);
  });
});

describe("buildTailscaleHttpsBaseUrl", () => {
  it("omits the default HTTPS port", () => {
    expect(buildTailscaleHttpsBaseUrl({ magicDnsName: "laptop.tailnet.ts.net" })).toBe(
      "https://laptop.tailnet.ts.net/",
    );
  });

  it("includes a non-default serve port", () => {
    expect(
      buildTailscaleHttpsBaseUrl({ magicDnsName: "laptop.tailnet.ts.net", servePort: 8443 }),
    ).toBe("https://laptop.tailnet.ts.net:8443/");
  });
});
