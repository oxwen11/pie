import { describe, expect, it } from "vitest";

import { isUnsafeRef } from "../src/git/shared";

describe("isUnsafeRef", () => {
  it("rejects a leading dash", () => {
    expect(isUnsafeRef("-ref")).toBe(true);
    expect(isUnsafeRef("--output")).toBe(true);
  });

  it("rejects ..", () => {
    expect(isUnsafeRef("..")).toBe(true);
    expect(isUnsafeRef("foo..bar")).toBe(true);
    expect(isUnsafeRef("refs/../heads/main")).toBe(true);
  });

  it("rejects control characters", () => {
    expect(isUnsafeRef("foo\0bar")).toBe(true);
  });

  it("rejects whitespace", () => {
    expect(isUnsafeRef("foo bar")).toBe(true);
    expect(isUnsafeRef("foo\tbar")).toBe(true);
    expect(isUnsafeRef(" main")).toBe(true);
  });

  it("accepts valid refs", () => {
    expect(isUnsafeRef("main")).toBe(false);
    expect(isUnsafeRef("feature/foo")).toBe(false);
    expect(isUnsafeRef("release-1.2.3")).toBe(false);
  });
});
