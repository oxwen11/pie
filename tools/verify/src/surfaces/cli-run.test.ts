import { describe, expect, it } from "vitest";

import { isHelpOrVersion } from "./cli.ts";

describe("isHelpOrVersion", () => {
  it("treats help and version flags as not needing a launched daemon", () => {
    expect(isHelpOrVersion(["--help"])).toBe(true);
    expect(isHelpOrVersion(["-h"])).toBe(true);
    expect(isHelpOrVersion(["--version"])).toBe(true);
    expect(isHelpOrVersion(["-v"])).toBe(true);
    expect(isHelpOrVersion(["daemon", "--help"])).toBe(true);
  });

  it("requires a current run for real CLI argv", () => {
    expect(isHelpOrVersion([])).toBe(false);
    expect(isHelpOrVersion(["daemon", "status"])).toBe(false);
  });
});
