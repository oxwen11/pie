import { SettingsSchema, type Settings } from "@getpie/contract";
import { Schema } from "effect";
import { parse, stringify } from "smol-toml";

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: "system" },
};

export const SETTINGS_FILE_HEADER = `# pie operator settings. Edit this file or use the Settings page.
# Saving from the Settings page rewrites the file and does not keep comments.

`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fill missing known keys with defaults. Unknown keys are dropped so an older
 * pie can still read a newer file. A present-but-wrong `appearance` table is
 * left as-is so schema decode fails instead of silently resetting it.
 */
export function overlaySettingsDefaults(raw: unknown) {
  if (!isRecord(raw)) return raw;
  if (raw.appearance !== undefined && !isRecord(raw.appearance)) return raw;
  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  return {
    appearance: {
      theme: "theme" in appearance ? appearance.theme : DEFAULT_SETTINGS.appearance.theme,
    },
  };
}

/** Empty / whitespace-only files are treated as an empty table, not a parse error. */
export function parseSettingsToml(text: string): unknown {
  return text.trim() === "" ? {} : parse(text);
}

export function decodeSettings(raw: unknown): Settings {
  return Schema.decodeUnknownSync(SettingsSchema)(overlaySettingsDefaults(raw));
}

export function stringifySettingsToml(settings: Settings): string {
  const body = stringify(settings);
  const withNewline = body.endsWith("\n") ? body : `${body}\n`;
  return `${SETTINGS_FILE_HEADER}${withNewline}`;
}
