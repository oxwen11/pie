import { describe, expect, it } from "vitest";

import { healthUrls, loopbackOrigins, urlPort } from "./http.ts";

describe("urlPort", () => {
  it("reads the port from a daemon address", () => {
    expect(urlPort("http://127.0.0.1:4182")).toBe(4182);
    expect(urlPort("http://127.0.0.1:4182/")).toBe(4182);
  });

  it("rejects an address with no port", () => {
    expect(() => urlPort("http://127.0.0.1")).toThrow(/no port/);
  });
});

describe("loopbackOrigins", () => {
  it("includes IPv6 so Node fetch can reach Vite on [::1]", () => {
    expect(loopbackOrigins(4190)).toEqual([
      "http://127.0.0.1:4190",
      "http://localhost:4190",
      "http://[::1]:4190",
    ]);
    expect(healthUrls(4190)).toContain("http://[::1]:4190/api/health");
  });
});
