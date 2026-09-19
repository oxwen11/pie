import { describe, expect, it } from "vitest";

import { parseRefNames } from "../../src/git/shared";

describe("parseRefNames", () => {
  it("splits mixed local and remote refs, local first in all", () => {
    expect(parseRefNames("refs/heads/main\nrefs/heads/feature\nrefs/remotes/origin/main")).toEqual({
      local: ["main", "feature"],
      remotes: ["origin/main"],
      all: ["main", "feature", "origin/main"],
    });
  });

  it("ignores trailing newline and blank lines", () => {
    expect(parseRefNames("refs/heads/main\n\nrefs/remotes/origin/main\n")).toEqual({
      local: ["main"],
      remotes: ["origin/main"],
      all: ["main", "origin/main"],
    });
  });

  it("trims whitespace around lines", () => {
    expect(parseRefNames("  refs/heads/main  \n\trefs/remotes/origin/main\t")).toEqual({
      local: ["main"],
      remotes: ["origin/main"],
      all: ["main", "origin/main"],
    });
  });

  it("ignores unknown prefixes", () => {
    expect(
      parseRefNames("refs/tags/v1\nrefs/heads/main\nrefs/stash\nrefs/remotes/origin/main\n"),
    ).toEqual({
      local: ["main"],
      remotes: ["origin/main"],
      all: ["main", "origin/main"],
    });
  });

  it("preserves encounter order within each group", () => {
    expect(
      parseRefNames("refs/heads/z\nrefs/remotes/origin/a\nrefs/heads/a\nrefs/remotes/origin/z"),
    ).toEqual({
      local: ["z", "a"],
      remotes: ["origin/a", "origin/z"],
      all: ["z", "a", "origin/a", "origin/z"],
    });
  });

  it("returns empty groups for empty output", () => {
    expect(parseRefNames("")).toEqual({ local: [], remotes: [], all: [] });
  });
});
