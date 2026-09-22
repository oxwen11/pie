import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

export const ThemePreferenceSchema = Schema.Literals(["system", "light", "dark"]);
export type ThemePreference = typeof ThemePreferenceSchema.Type;

export const AppearanceSettingsSchema = Schema.Struct({
  theme: ThemePreferenceSchema,
});
export type AppearanceSettings = typeof AppearanceSettingsSchema.Type;

export const SettingsSchema = Schema.Struct({
  appearance: AppearanceSettingsSchema,
});
export type Settings = typeof SettingsSchema.Type;

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: "system" },
};

/** On-disk shape: missing keys take defaults; invalid known values fail. */
const SettingsFileSchema = Schema.Struct({
  appearance: Schema.optionalKey(
    Schema.Struct({
      theme: Schema.optionalKey(ThemePreferenceSchema),
    }),
  ),
});

export function decodeSettingsJson(raw: string): Settings {
  const file = Schema.decodeUnknownSync(SettingsFileSchema)(JSON.parse(raw) as unknown);
  return {
    appearance: { theme: file.appearance?.theme ?? DEFAULT_SETTINGS.appearance.theme },
  };
}

export function encodeSettingsJson(settings: Settings): string {
  return `${JSON.stringify(Schema.encodeSync(SettingsSchema)(settings), null, 2)}\n`;
}

const base = oc.errors(serverErrors);

export const settingsContract = {
  get: base.output(SettingsSchema),
  update: base.input(SettingsSchema).output(SettingsSchema),
};
