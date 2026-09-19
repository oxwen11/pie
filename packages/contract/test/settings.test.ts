import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeSettingsJson,
  DEFAULT_SETTINGS,
  encodeSettingsJson,
  SettingsSchema,
} from "../src/settings";

const accepts = (value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(SettingsSchema)(value));

describe("SettingsSchema", () => {
  it("accepts system, light, and dark", () => {
    expect(accepts({ appearance: { theme: "system" } })).toBe(true);
    expect(accepts({ appearance: { theme: "light" } })).toBe(true);
    expect(accepts({ appearance: { theme: "dark" } })).toBe(true);
  });

  it("rejects an unknown theme", () => {
    expect(accepts({ appearance: { theme: "neon" } })).toBe(false);
  });
});

describe("decodeSettingsJson", () => {
  it("fills missing keys with defaults", () => {
    expect(decodeSettingsJson("{}")).toEqual(DEFAULT_SETTINGS);
    expect(decodeSettingsJson(`{"appearance":{}}`)).toEqual(DEFAULT_SETTINGS);
  });

  it("reads a saved theme", () => {
    expect(decodeSettingsJson(`{"appearance":{"theme":"dark"}}`)).toEqual({
      appearance: { theme: "dark" },
    });
  });

  it("rejects invalid known values", () => {
    expect(() => decodeSettingsJson(`{"appearance":{"theme":"neon"}}`)).toThrow(/theme/);
  });

  it("rejects corrupt JSON", () => {
    expect(() => decodeSettingsJson("{")).toThrow(/JSON/);
  });
});

describe("encodeSettingsJson", () => {
  it("pretty-prints the complete document", () => {
    expect(encodeSettingsJson({ appearance: { theme: "light" } })).toBe(
      `${JSON.stringify({ appearance: { theme: "light" } }, null, 2)}\n`,
    );
  });
});
