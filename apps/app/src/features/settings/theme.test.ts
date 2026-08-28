import { describe, expect, it } from "vitest";

import { isTheme, resolveTheme } from "./theme";

describe("isTheme", () => {
  it("accepts the three appearance values", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTheme("neon")).toBe(false);
    expect(isTheme(1)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("returns an explicit light or dark preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
