import { type Theme, SettingsSchema, type Settings } from "@getpie/contract";
import { Schema } from "effect";
import { parse, stringify } from "smol-toml";

export const DEFAULT_SETTINGS: Settings = {
  ui: { theme: "system" },
};

export const SETTINGS_FILE_HEADER = `# pie settings. Edit this file or use the Settings page.
# Saving rewrites the file and does not keep comments.

`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fill missing known keys with defaults. Unknown keys are dropped from the
 * decoded operator slice so an older pie can still read a newer file. A
 * present-but-wrong `ui` table is left as-is so schema decode fails instead
 * of silently resetting it. `appearance.theme` is accepted when `ui.theme`
 * is absent (pre-`[ui]` documents).
 */
export function overlaySettingsDefaults(raw: unknown) {
  if (!isRecord(raw)) return raw;
  if (raw.ui !== undefined && !isRecord(raw.ui)) return raw;
  const ui = isRecord(raw.ui) ? raw.ui : {};
  if ("theme" in ui) {
    return { ui: { theme: ui.theme } };
  }
  if (raw.appearance !== undefined && !isRecord(raw.appearance)) return raw;
  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  return {
    ui: {
      theme: "theme" in appearance ? appearance.theme : DEFAULT_SETTINGS.ui.theme,
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

/**
 * Overlay `ui.theme` onto an existing document so sibling keys (`ui.window`,
 * unknown tables) survive a Settings save. Drops the pre-`[ui]` `appearance`
 * table once theme lives under `ui`.
 */
export function assignUiTheme(raw: unknown, theme: Theme): Record<string, unknown> {
  if (isRecord(raw) && raw.ui !== undefined && !isRecord(raw.ui)) {
    throw new Error("ui must be a table");
  }
  const document: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const ui: Record<string, unknown> = isRecord(document.ui) ? { ...document.ui } : {};
  ui.theme = theme;
  document.ui = ui;
  delete document.appearance;
  return document;
}

export function stringifySettingsToml(document: unknown): string {
  const body = stringify(document);
  const withNewline = body.endsWith("\n") ? body : `${body}\n`;
  return `${SETTINGS_FILE_HEADER}${withNewline}`;
}
