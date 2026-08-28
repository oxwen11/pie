import { describe, expect, it } from "vitest";

import { defaultWorktreeBase } from "./draft-worktree-base";

describe("defaultWorktreeBase", () => {
  it("prefers defaultBranch over current", () => {
    expect(
      defaultWorktreeBase({
        kind: "repository",
        current: "feature",
        defaultBranch: "main",
        branches: ["main", "feature"],
        remotes: [],
      }),
    ).toBe("main");
  });

  it("falls back to current when defaultBranch is null", () => {
    expect(
      defaultWorktreeBase({
        kind: "repository",
        current: "feature",
        defaultBranch: null,
        branches: ["feature"],
        remotes: [],
      }),
    ).toBe("feature");
  });

  it("returns null when branch info is missing or the workspace is not a repository", () => {
    expect(defaultWorktreeBase(undefined)).toBeNull();
    expect(defaultWorktreeBase({ kind: "not-repository" })).toBeNull();
    expect(defaultWorktreeBase({ kind: "workspace-unavailable" })).toBeNull();
  });
});
