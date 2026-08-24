import { describe, expect, it } from "vitest";

import { defaultWorktreeBase } from "./draft-worktree-base-select";

describe("defaultWorktreeBase", () => {
  it("prefers defaultBranch over current", () => {
    expect(
      defaultWorktreeBase({
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
        current: "feature",
        defaultBranch: null,
        branches: ["feature"],
        remotes: [],
      }),
    ).toBe("feature");
  });

  it("returns null when branch info is missing", () => {
    expect(defaultWorktreeBase(undefined)).toBeNull();
  });
});
