import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  allocateProjectFolderName,
  DEFAULT_NEW_PROJECT_DIR,
  formatAllocateDate,
  resolveNewProjectRoot,
} from "../src/project/allocate-folder";

describe("resolveNewProjectRoot", () => {
  it("uses PIE_NEW_PROJECT_ROOT when set", () => {
    expect(
      resolveNewProjectRoot({ PIE_NEW_PROJECT_ROOT: "/tmp/new-projects" }, () => "/home/user"),
    ).toBe(path.resolve("/tmp/new-projects"));
  });

  it("treats a blank override as unset", () => {
    expect(resolveNewProjectRoot({ PIE_NEW_PROJECT_ROOT: "  " }, () => "/home/user")).toBe(
      path.join("/home/user", DEFAULT_NEW_PROJECT_DIR),
    );
  });

  it("defaults to ~/Pie", () => {
    expect(resolveNewProjectRoot({}, () => "/home/user")).toBe(
      path.join("/home/user", DEFAULT_NEW_PROJECT_DIR),
    );
    expect(DEFAULT_NEW_PROJECT_DIR).toBe("Pie");
  });
});

describe("allocateProjectFolderName", () => {
  const noon = new Date(2026, 8, 16, 12, 0, 0);

  it("nests a fixed leaf under the local calendar date", () => {
    expect(formatAllocateDate(noon)).toBe("2026-09-16");
    expect(allocateProjectFolderName(noon, 1)).toBe(path.join("2026-09-16", "Chat-1"));
  });

  it("numbers later attempts Chat-2, Chat-3, …", () => {
    expect(allocateProjectFolderName(noon, 2)).toBe(path.join("2026-09-16", "Chat-2"));
    expect(allocateProjectFolderName(noon, 3)).toBe(path.join("2026-09-16", "Chat-3"));
  });
});

describe("os.homedir default", () => {
  it("resolves against the real home when no override is passed", () => {
    expect(resolveNewProjectRoot({})).toBe(path.join(os.homedir(), DEFAULT_NEW_PROJECT_DIR));
  });
});
