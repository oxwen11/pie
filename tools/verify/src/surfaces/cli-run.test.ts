import { describe, expect, it } from "vitest";

import { isHelpOrVersion } from "./cli.ts";

describe("isHelpOrVersion", () => {
  it("requires a current run for real CLI argv", () => {
    expect(isHelpOrVersion([])).toBe(false);
    expect(isHelpOrVersion(["daemon", "status"])).toBe(false);
  });
});
