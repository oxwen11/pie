import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateWorktreeBranchName,
  generateWorktreeBranchSuffix,
  generateWorktreeKey,
  isValidWorktreeKey,
  repoWorktreeGroupKey,
  worktreeDirectory,
} from "../src/git/worktree";

describe("worktree paths", () => {
  it("matches Cursor-style layout under PIE_HOME", () => {
    const pieHome = "/Users/dinq/.pie";
    const repoRoot = "/Users/dinq/dev/pie";
    const worktreeKey = "mv98";

    expect(repoWorktreeGroupKey(repoRoot)).toBe("pie");
    expect(worktreeDirectory(pieHome, repoRoot, worktreeKey)).toBe(
      path.join(pieHome, "worktrees", "pie", worktreeKey),
    );
  });

  it("generates short directory keys and pie/ branch names", () => {
    expect(generateWorktreeKey()).toMatch(/^[a-z0-9]{4}$/);
    expect(generateWorktreeBranchSuffix()).toMatch(/^[a-f0-9]{8}$/);
    expect(generateWorktreeBranchName("a50b231d")).toBe("pie/a50b231d");
  });

  it("validates worktree directory keys", () => {
    expect(isValidWorktreeKey("mv98")).toBe(true);
    expect(isValidWorktreeKey("MV98")).toBe(false);
    expect(isValidWorktreeKey("../x")).toBe(false);
  });
});
