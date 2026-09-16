import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOCATE_FALLBACK_SLUG,
  allocateProjectFolderName,
  allocateProjectLeafName,
  DEFAULT_NEW_PROJECT_DIR,
  formatAllocateDate,
  resolveNewProjectRoot,
  slugifyProjectTitle,
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

describe("slugifyProjectTitle", () => {
  it("returns undefined for empty or punctuation-only titles", () => {
    expect(slugifyProjectTitle(undefined)).toBeUndefined();
    expect(slugifyProjectTitle("")).toBeUndefined();
    expect(slugifyProjectTitle("   ")).toBeUndefined();
    expect(slugifyProjectTitle("!!!")).toBeUndefined();
  });

  it("lowercases, strips accents, and collapses separators", () => {
    expect(slugifyProjectTitle("  Fix Café Login!! ")).toBe("fix-cafe-login");
  });

  it("truncates to 40 characters on a segment boundary", () => {
    const slug = slugifyProjectTitle("a".repeat(50));
    expect(slug).toBe("a".repeat(40));
  });
});

describe("allocateProjectFolderName", () => {
  const noon = new Date(2026, 8, 16, 12, 0, 0);

  it("nests a fallback slug under the local calendar date", () => {
    expect(formatAllocateDate(noon)).toBe("2026-09-16");
    expect(allocateProjectLeafName(undefined, 1)).toBe(ALLOCATE_FALLBACK_SLUG);
    expect(allocateProjectFolderName(noon, undefined, 1)).toBe(
      path.join("2026-09-16", ALLOCATE_FALLBACK_SLUG),
    );
  });

  it("nests a slug from the title under the date", () => {
    expect(allocateProjectFolderName(noon, "Ask Pi anything", 1)).toBe(
      path.join("2026-09-16", "ask-pi-anything"),
    );
  });

  it("suffixes the leaf from -2 on later attempts", () => {
    expect(allocateProjectFolderName(noon, undefined, 2)).toBe(
      path.join("2026-09-16", `${ALLOCATE_FALLBACK_SLUG}-2`),
    );
    expect(allocateProjectFolderName(noon, "hello", 3)).toBe(path.join("2026-09-16", "hello-3"));
  });
});

describe("os.homedir default", () => {
  it("resolves against the real home when no override is passed", () => {
    expect(resolveNewProjectRoot({})).toBe(path.join(os.homedir(), DEFAULT_NEW_PROJECT_DIR));
  });
});
