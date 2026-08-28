import { describe, expect, it } from "vitest";

import { isTheme, resolveAppearance } from "./appearance";

describe("resolveAppearance", () => {
  it("follows the OS only when the preference is system", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });
});

describe("isTheme", () => {
  it("accepts the three stored values", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
  });
});
