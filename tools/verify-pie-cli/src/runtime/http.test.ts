import { describe, expect, it } from "vitest";

import { urlPort } from "./http.ts";

describe("urlPort", () => {
  it("reads the port from a daemon address", () => {
    expect(urlPort("http://127.0.0.1:4182")).toBe(4182);
    expect(urlPort("http://127.0.0.1:4182/")).toBe(4182);
  });

  it("rejects an address with no port", () => {
    expect(() => urlPort("http://127.0.0.1")).toThrow(/no port/);
  });
});
