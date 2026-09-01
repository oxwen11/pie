import { describe, expect, it } from "vitest";

import { DEFAULT_ROOT } from "./config.ts";

describe("DEFAULT_ROOT", () => {
  it("isolates under /tmp/pie-verify-web", () => {
    expect(DEFAULT_ROOT).toBe("/tmp/pie-verify-web");
  });
});
