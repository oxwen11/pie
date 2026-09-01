import { describe, expect, it } from "vitest";

import { classifyExisting } from "./reuse.ts";

describe("classifyExisting", () => {
  it("reuses a healthy run", () => {
    expect(classifyExisting({ healthy: true, live: true })).toBe("reuse");
    expect(classifyExisting({ healthy: true, live: false })).toBe("reuse");
  });

  it("treats a dead pointer as stale so relaunch can drop it", () => {
    expect(classifyExisting({ healthy: false, live: false })).toBe("stale");
  });

  it("requires --replace when processes are still live", () => {
    expect(classifyExisting({ healthy: false, live: true })).toBe("live");
  });
});
