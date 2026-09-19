import { describe, expect, it } from "vitest";

import {
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
  readThemePreference,
  windowBackgroundColor,
} from "./window-background";

describe("readThemePreference", () => {
  it("reads a saved theme", () => {
    expect(readThemePreference(`{"appearance":{"theme":"dark"}}`)).toBe("dark");
  });

  it("falls back on missing, corrupt, or invalid input", () => {
    expect(readThemePreference("{}")).toBeUndefined();
    expect(readThemePreference("{")).toBeUndefined();
    expect(readThemePreference(`{"appearance":{"theme":"neon"}}`)).toBeUndefined();
  });
});

describe("windowBackgroundColor", () => {
  it("follows the system when theme is missing or system", () => {
    expect(windowBackgroundColor(undefined, true)).toBe(WINDOW_BACKGROUND_DARK);
    expect(windowBackgroundColor("system", false)).toBe(WINDOW_BACKGROUND_LIGHT);
  });

  it("honors an explicit preference", () => {
    expect(windowBackgroundColor("dark", false)).toBe(WINDOW_BACKGROUND_DARK);
    expect(windowBackgroundColor("light", true)).toBe(WINDOW_BACKGROUND_LIGHT);
  });
});
