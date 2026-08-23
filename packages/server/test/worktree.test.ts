import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateWorktreeBranchName,
  isValidWorktreeId,
  repoWorktreeGroupKey,
  worktreeDirectory,
} from "../src/git/worktree";

describe("worktree paths", () => {
  it("groups worktrees by repository under PIE_HOME", () => {
    const pieHome = "/home/user/.pie";
    const repoRoot = "/home/user/dev/pie";
    const worktreeId = "550e8400-e29b-41d4-a716-446655440000";

    expect(repoWorktreeGroupKey(repoRoot)).toMatch(/^pie-[a-f0-9]{8}$/);
    expect(worktreeDirectory(pieHome, repoRoot, worktreeId)).toBe(
      path.join(pieHome, "worktrees", repoWorktreeGroupKey(repoRoot), worktreeId),
    );
  });

  it("accepts session ids as worktree directory names", () => {
    expect(isValidWorktreeId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidWorktreeId("../escape")).toBe(false);
  });

  it("defaults branch names from worktree ids", () => {
    expect(generateWorktreeBranchName("550e8400")).toBe("pie/550e8400");
  });
});
