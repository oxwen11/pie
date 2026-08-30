import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  SETTINGS_DEFAULTS,
  SettingsFileSchema,
  SettingsSchema,
  settingsFromFile,
  ThemeSchema,
} from "../src/settings";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("ThemeSchema", () => {
  it("accepts the three appearance values", () => {
    expect(accepts(ThemeSchema, "system")).toBe(true);
    expect(accepts(ThemeSchema, "light")).toBe(true);
    expect(accepts(ThemeSchema, "dark")).toBe(true);
  });

  it("rejects an unknown theme", () => {
    expect(accepts(ThemeSchema, "neon")).toBe(false);
    expect(accepts(ThemeSchema, "")).toBe(false);
  });
});

describe("SettingsSchema", () => {
  it("accepts the canonical v1 document", () => {
    expect(accepts(SettingsSchema, SETTINGS_DEFAULTS)).toBe(true);
  });

  it("rejects a newer version", () => {
    expect(accepts(SettingsSchema, { version: 2, appearance: { theme: "dark" } })).toBe(false);
  });
});

describe("SettingsFileSchema", () => {
  it("accepts an empty object so a sparse TOML file can fill defaults", () => {
    expect(accepts(SettingsFileSchema, {})).toBe(true);
    expect(settingsFromFile({})).toEqual(SETTINGS_DEFAULTS);
  });

  it("fills a missing theme from defaults", () => {
    expect(settingsFromFile({ version: 1, appearance: {} })).toEqual(SETTINGS_DEFAULTS);
  });

  it("keeps an explicit theme", () => {
    expect(settingsFromFile({ appearance: { theme: "dark" } })).toEqual({
      version: 1,
      appearance: { theme: "dark" },
    });
  });
});
