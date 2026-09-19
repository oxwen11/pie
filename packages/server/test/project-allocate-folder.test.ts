import path from "node:path";

import { describe, expect, it } from "vitest";

import { allocateProjectFolderName } from "../src/project/allocate-folder";

describe("allocateProjectFolderName", () => {
  const noon = new Date(2026, 8, 16, 12, 0, 0);

  it("nests Chat-n under the local calendar date", () => {
    expect(allocateProjectFolderName(noon, 1)).toBe(path.join("2026-09-16", "Chat-1"));
    expect(allocateProjectFolderName(noon, 2)).toBe(path.join("2026-09-16", "Chat-2"));
    expect(allocateProjectFolderName(noon, 3)).toBe(path.join("2026-09-16", "Chat-3"));
  });
});
