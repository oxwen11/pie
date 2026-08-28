import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  decodeSettings,
  overlaySettingsDefaults,
  parseSettingsToml,
  stringifySettingsToml,
} from "../src/settings/codec";

describe("parseSettingsToml", () => {
  it("treats empty and whitespace-only files as an empty table", () => {
    expect(parseSettingsToml("")).toEqual({});
    expect(parseSettingsToml("  \n  ")).toEqual({});
  });

  it("parses an appearance table", () => {
    expect(parseSettingsToml('[appearance]\ntheme = "dark"\n')).toEqual({
      appearance: { theme: "dark" },
    });
  });

  it("throws on invalid TOML", () => {
    expect(() => parseSettingsToml("theme = [")).toThrow(/TOML|Unexpected|end of/i);
  });
});

describe("overlaySettingsDefaults", () => {
  it("fills a missing theme from defaults", () => {
    expect(overlaySettingsDefaults({})).toEqual(DEFAULT_SETTINGS);
    expect(overlaySettingsDefaults({ appearance: {} })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps an explicit theme so decode can reject invalid values", () => {
    expect(overlaySettingsDefaults({ appearance: { theme: "sepia" } })).toEqual({
      appearance: { theme: "sepia" },
    });
  });

  it("drops unknown keys so a newer file still loads", () => {
    expect(
      overlaySettingsDefaults({
        appearance: { theme: "light", extra: true },
        experimental: { foo: 1 },
      }),
    ).toEqual({ appearance: { theme: "light" } });
  });
});

describe("decodeSettings", () => {
  it("decodes defaults from an empty object", () => {
    expect(decodeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects an invalid theme", () => {
    expect(() => decodeSettings({ appearance: { theme: "sepia" } })).toThrow(/Expected/);
  });
});

describe("stringifySettingsToml", () => {
  it("writes a header and an appearance table", () => {
    const text = stringifySettingsToml({ appearance: { theme: "dark" } });
    expect(text.startsWith("# pie operator settings.")).toBe(true);
    expect(text).toContain("[appearance]");
    expect(text).toContain('theme = "dark"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("round-trips a decoded document", () => {
    const original = { appearance: { theme: "light" as const } };
    expect(decodeSettings(parseSettingsToml(stringifySettingsToml(original)))).toEqual(original);
  });
});
