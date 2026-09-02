import path from "node:path";

import { describe, expect, it } from "vitest";

import { contains, hasBinaryMagicPrefix, toPosixPath } from "../src/path-safety";

describe("contains", () => {
  it("is true when parent equals child", () => {
    expect(contains("/a/b", "/a/b")).toBe(true);
  });

  it("is true for a direct child", () => {
    expect(contains("/a/b", "/a/b/c")).toBe(true);
  });

  it("is true for a deep child", () => {
    expect(contains("/a/b", "/a/b/c/d")).toBe(true);
  });

  it("is false for a sibling that shares a path prefix", () => {
    expect(contains("/a/b", "/a/bc")).toBe(false);
  });

  it("is false when a path with .. escapes the parent", () => {
    expect(contains("/a/b", "/a/b/../c")).toBe(false);
  });

  it("treats trailing separators as the same directory", () => {
    expect(contains("/a/b/", "/a/b")).toBe(true);
    expect(contains("/a/b", "/a/b/")).toBe(true);
    expect(contains("/a/b/", "/a/b/c")).toBe(true);
  });
});

describe("toPosixPath", () => {
  it("joins platform segments with /", () => {
    expect(toPosixPath(["src", "git", "service.ts"].join(path.sep))).toBe("src/git/service.ts");
  });

  it("leaves an already-posix path unchanged on this platform", () => {
    expect(toPosixPath("src/git/service.ts")).toBe("src/git/service.ts");
  });
});

describe("hasBinaryMagicPrefix", () => {
  it("detects PDF, PNG, and JPEG prefixes", () => {
    expect(hasBinaryMagicPrefix(Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
    expect(
      hasBinaryMagicPrefix(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe(true);
    expect(hasBinaryMagicPrefix(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
  });

  it("is false for an empty buffer", () => {
    expect(hasBinaryMagicPrefix(new Uint8Array())).toBe(false);
  });

  it("is false for plain UTF-8 text", () => {
    expect(hasBinaryMagicPrefix(new TextEncoder().encode("hello world"))).toBe(false);
  });
});
