import { describe, expect, it } from "vitest";

import { isHelpOrVersion } from "./cli.ts";

describe("isHelpOrVersion", () => {
  it("requires a current run for real CLI argv", () => {
    expect(isHelpOrVersion([])).toBe(false);
    expect(isHelpOrVersion(["daemon", "status"])).toBe(false);
  });

  it("allows help and version requests without a current run", () => {
    for (const flag of ["--help", "-h", "--version", "-v"]) {
      expect(isHelpOrVersion([flag])).toBe(true);
    }
    expect(isHelpOrVersion(["daemon", "--help"])).toBe(true);
  });
});
