import { describe, expect, it } from "vitest";

import {
  buildTailscaleHttpsBaseUrl,
  decodeTailscaleServeOwnership,
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

describe("decodeTailscaleServeOwnership", () => {
  it("treats an empty status as unused", () => {
    expect(decodeTailscaleServeOwnership("{}", 4000)).toBe("empty");
    expect(decodeTailscaleServeOwnership("", 4000)).toBe("empty");
  });

  it("recognizes this computer's loopback handler", () => {
    expect(
      decodeTailscaleServeOwnership(
        JSON.stringify({
          Web: { "https://host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4000" } } } },
        }),
        4000,
      ),
    ).toBe("ours");
  });

  it("refuses a handler that points somewhere else", () => {
    expect(
      decodeTailscaleServeOwnership(
        JSON.stringify({
          Web: { "https://host:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
        }),
        4000,
      ),
    ).toBe("foreign");
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
