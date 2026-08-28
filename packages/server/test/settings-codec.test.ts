import { SETTINGS_DEFAULTS } from "@getpie/contract/settings";
import { describe, expect, it } from "vitest";

import {
  parseSettingsToml,
  SETTINGS_FILE_HEADER,
  stringifySettingsToml,
} from "../src/settings/codec";

describe("parseSettingsToml", () => {
  it("fills defaults from an empty document", () => {
    const parsed = parseSettingsToml("");
    expect(parsed).toEqual({ ok: true, settings: SETTINGS_DEFAULTS });
  });

  it("reads a canonical v1 file", () => {
    const parsed = parseSettingsToml(`
version = 1

[appearance]
theme = "dark"
`);
    expect(parsed).toEqual({
      ok: true,
      settings: { version: 1, appearance: { theme: "dark" } },
    });
  });

  it("ignores comments", () => {
    const parsed = parseSettingsToml(`
# a comment
[appearance]
theme = "light" # trailing
`);
    expect(parsed).toEqual({
      ok: true,
      settings: { version: 1, appearance: { theme: "light" } },
    });
  });

  it("fails loud on invalid TOML", () => {
    expect(parseSettingsToml("theme = [")).toMatchObject({ ok: false, reason: "syntax" });
  });

  it("fails loud on an unknown theme", () => {
    expect(parseSettingsToml('[appearance]\ntheme = "neon"\n')).toMatchObject({
      ok: false,
      reason: "schema",
    });
  });

  it("fails loud on a newer version", () => {
    expect(parseSettingsToml("version = 2\n")).toMatchObject({ ok: false, reason: "schema" });
  });
});

describe("stringifySettingsToml", () => {
  it("writes a header plus canonical tables", () => {
    const text = stringifySettingsToml({ version: 1, appearance: { theme: "system" } });
    expect(text.startsWith(SETTINGS_FILE_HEADER)).toBe(true);
    expect(text).toContain("version = 1");
    expect(text).toContain("[appearance]");
    expect(text).toContain('theme = "system"');
  });

  it("round-trips through parse", () => {
    const settings = { version: 1 as const, appearance: { theme: "dark" as const } };
    const parsed = parseSettingsToml(stringifySettingsToml(settings));
    expect(parsed).toEqual({ ok: true, settings });
  });
});
