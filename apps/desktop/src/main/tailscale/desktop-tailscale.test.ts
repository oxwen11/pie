import { describe, expect, it } from "vitest";

import { portFromHttpBaseUrl } from "./desktop-tailscale";

describe("portFromHttpBaseUrl", () => {
  it("reads an explicit loopback port", () => {
    expect(portFromHttpBaseUrl("http://127.0.0.1:41234")).toBe(41234);
  });

  it("defaults http and https when the URL omits a port", () => {
    expect(portFromHttpBaseUrl("http://127.0.0.1")).toBe(80);
    expect(portFromHttpBaseUrl("https://laptop.tailnet.ts.net")).toBe(443);
  });

  it("returns null for garbage", () => {
    expect(portFromHttpBaseUrl("not a url")).toBeNull();
  });
});
