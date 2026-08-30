import {
  type Settings,
  SettingsFileSchema,
  settingsFromFile,
  SettingsSchema,
} from "@getpie/contract/settings";
import { Exit, Schema } from "effect";
import { parse, stringify } from "smol-toml";

export const SETTINGS_FILE_HEADER =
  "# pie user settings. Saving from the Settings page rewrites this file.\n";

export type ParseSettingsFailure = {
  readonly reason: "syntax" | "schema";
  readonly cause: unknown;
};

export type ParseSettingsResult =
  | { readonly ok: true; readonly settings: Settings }
  | ({ readonly ok: false } & ParseSettingsFailure);

/** Synchronous TOML → Settings. Not an Effect: parsing is deterministic. */
export function parseSettingsToml(text: string): ParseSettingsResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (cause) {
    return { ok: false, reason: "syntax", cause };
  }
  const decoded = Schema.decodeUnknownExit(SettingsFileSchema)(raw);
  if (Exit.isFailure(decoded)) {
    return { ok: false, reason: "schema", cause: decoded.cause };
  }
  return { ok: true, settings: settingsFromFile(decoded.value) };
}

/** Canonical Settings → TOML. Unknown keys are not preserved. */
export function stringifySettingsToml(settings: Settings): string {
  const encoded = Schema.encodeUnknownSync(SettingsSchema)(settings);
  return `${SETTINGS_FILE_HEADER}${stringify(encoded)}\n`;
}
