import path from "node:path";

import { describe, expect, it } from "vitest";

import { isValidWorktreeKey, repoWorktreeGroupKey, worktreeDirectory } from "../src/git/worktree";

describe("worktree paths", () => {
  it("matches Cursor-style layout under PIE_HOME", () => {
    const worktreesDir = "/Users/dinq/.pie/worktrees";
    const repoRoot = "/Users/dinq/dev/pie";
    const worktreeKey = "mv98";

    expect(repoWorktreeGroupKey(repoRoot)).toBe("pie");
    expect(worktreeDirectory(worktreesDir, repoRoot, worktreeKey)).toBe(
      path.join(worktreesDir, "pie", worktreeKey),
    );
  });

  it("validates worktree directory keys", () => {
    expect(isValidWorktreeKey("mv98")).toBe(true);
    expect(isValidWorktreeKey("MV98")).toBe(false);
    expect(isValidWorktreeKey("../x")).toBe(false);
  });
});
