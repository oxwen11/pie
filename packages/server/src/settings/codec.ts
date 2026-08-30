import { type Theme, SettingsSchema, type Settings } from "@getpie/contract";
import { Schema } from "effect";

export const DEFAULT_SETTINGS: Settings = {
  ui: { theme: "system" },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fill missing known keys with defaults. Unknown keys are dropped from the
 * decoded operator slice so an older pie can still read a newer file. A
 * present-but-wrong `ui` object is left as-is so schema decode fails instead
 * of silently resetting it. `appearance.theme` is accepted when `ui.theme`
 * is absent. `desktop` and `agent` are not part of this slice.
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

/** Empty / whitespace-only files are treated as an empty object, not a parse error. */
export function parseSettingsJson(text: string): unknown {
  return text.trim() === "" ? {} : JSON.parse(text);
}

export function decodeSettings(raw: unknown): Settings {
  return Schema.decodeUnknownSync(SettingsSchema)(overlaySettingsDefaults(raw));
}

/**
 * Move leftover `ui.window` onto `desktop.window` when the host object is
 * absent. Does not overwrite an existing `desktop.window`.
 */
function relocateUiWindowToDesktop(document: Record<string, unknown>): void {
  if (!isRecord(document.ui) || !("window" in document.ui)) {
    return;
  }
  const ui = { ...document.ui };
  const leftover = ui.window;
  delete ui.window;
  if (Object.keys(ui).length === 0) {
    delete document.ui;
  } else {
    document.ui = ui;
  }
  if (!isRecord(leftover)) {
    return;
  }
  const desktop: Record<string, unknown> = isRecord(document.desktop)
    ? { ...document.desktop }
    : {};
  document.desktop = desktop;
  if (!("window" in desktop)) {
    desktop.window = leftover;
  }
}

/**
 * Overlay `ui.theme` onto an existing document so sibling objects (`desktop`,
 * `agent`, unknown keys) survive a Settings save. Relocates leftover
 * `ui.window` to `desktop.window`. Drops a leftover `appearance` object once
 * theme lives under `ui`.
 */
export function assignUiTheme(raw: unknown, theme: Theme): Record<string, unknown> {
  if (isRecord(raw) && raw.ui !== undefined && !isRecord(raw.ui)) {
    throw new Error("ui must be an object");
  }
  if (isRecord(raw) && raw.desktop !== undefined && !isRecord(raw.desktop)) {
    throw new Error("desktop must be an object");
  }
  const document: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  relocateUiWindowToDesktop(document);
  const ui: Record<string, unknown> = isRecord(document.ui) ? { ...document.ui } : {};
  ui.theme = theme;
  document.ui = ui;
  delete document.appearance;
  return document;
}

export function stringifySettingsJson(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
