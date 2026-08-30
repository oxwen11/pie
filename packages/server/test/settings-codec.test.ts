import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  assignUiTheme,
  decodeSettings,
  overlaySettingsDefaults,
  parseSettingsJson,
  stringifySettingsJson,
} from "../src/settings/codec";

describe("parseSettingsJson", () => {
  it("treats empty and whitespace-only files as an empty object", () => {
    expect(parseSettingsJson("")).toEqual({});
    expect(parseSettingsJson("  \n  ")).toEqual({});
  });

  it("parses a ui object", () => {
    expect(parseSettingsJson('{"ui":{"theme":"dark"}}')).toEqual({
      ui: { theme: "dark" },
    });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSettingsJson("{")).toThrow(SyntaxError);
  });
});

describe("overlaySettingsDefaults", () => {
  it("fills a missing theme from defaults", () => {
    expect(overlaySettingsDefaults({})).toEqual(DEFAULT_SETTINGS);
    expect(overlaySettingsDefaults({ ui: {} })).toEqual(DEFAULT_SETTINGS);
    expect(overlaySettingsDefaults({ appearance: {} })).toEqual(DEFAULT_SETTINGS);
  });

  it("prefers ui.theme over a leftover appearance object", () => {
    expect(
      overlaySettingsDefaults({
        ui: { theme: "dark" },
        appearance: { theme: "light" },
      }),
    ).toEqual({ ui: { theme: "dark" } });
  });

  it("keeps an explicit theme so decode can reject invalid values", () => {
    expect(overlaySettingsDefaults({ ui: { theme: "sepia" } })).toEqual({
      ui: { theme: "sepia" },
    });
    expect(overlaySettingsDefaults({ appearance: { theme: "sepia" } })).toEqual({
      ui: { theme: "sepia" },
    });
  });

  it("drops unknown keys so a newer file still loads", () => {
    expect(
      overlaySettingsDefaults({
        ui: { theme: "light", extra: true, window: { width: 1400 } },
        experimental: { foo: 1 },
      }),
    ).toEqual({ ui: { theme: "light" } });
  });
});

describe("decodeSettings", () => {
  it("decodes defaults from an empty object", () => {
    expect(decodeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects an invalid theme", () => {
    expect(() => decodeSettings({ ui: { theme: "sepia" } })).toThrow(/Expected/);
  });
});

describe("assignUiTheme", () => {
  it("relocates leftover ui.window to desktop.window and drops appearance", () => {
    expect(
      assignUiTheme(
        {
          appearance: { theme: "light" },
          ui: { theme: "system", window: { width: 1400, height: 900, maximized: false } },
        },
        "dark",
      ),
    ).toEqual({
      ui: { theme: "dark" },
      desktop: { window: { width: 1400, height: 900, maximized: false } },
    });
  });

  it("does not overwrite an existing desktop.window", () => {
    expect(
      assignUiTheme(
        {
          ui: { theme: "system", window: { width: 1, height: 1, maximized: true } },
          desktop: { window: { width: 1400, height: 900, maximized: false } },
        },
        "dark",
      ),
    ).toEqual({
      ui: { theme: "dark" },
      desktop: { window: { width: 1400, height: 900, maximized: false } },
    });
  });

  it("preserves an agent object", () => {
    expect(assignUiTheme({ ui: { theme: "system" }, agent: { foo: 1 } }, "dark")).toEqual({
      ui: { theme: "dark" },
      agent: { foo: 1 },
    });
  });
});

describe("stringifySettingsJson", () => {
  it("writes pretty JSON with a trailing newline", () => {
    const text = stringifySettingsJson({ ui: { theme: "dark" } });
    expect(JSON.parse(text)).toEqual({ ui: { theme: "dark" } });
    expect(text).toContain('\n  "ui"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("round-trips a decoded document", () => {
    const original = { ui: { theme: "light" as const } };
    expect(decodeSettings(parseSettingsJson(stringifySettingsJson(original)))).toEqual(original);
  });
});
