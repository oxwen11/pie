import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

export const ThemeSchema = Schema.Literals(["system", "light", "dark"]);
export type Theme = typeof ThemeSchema.Type;

export const SettingsAppearanceSchema = Schema.Struct({
  theme: ThemeSchema,
});
export type SettingsAppearance = typeof SettingsAppearanceSchema.Type;

/** Canonical pie settings document. This is the wire shape and the write shape. */
export const SettingsSchema = Schema.Struct({
  version: Schema.Literal(1),
  appearance: SettingsAppearanceSchema,
});
export type Settings = typeof SettingsSchema.Type;

/**
 * On-disk TOML may omit keys a hand-author would skip. Missing fields fill from
 * {@link SETTINGS_DEFAULTS}; an explicit `version` other than `1` fails decode.
 */
export const SettingsFileSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Literal(1)),
  appearance: Schema.optionalKey(
    Schema.Struct({
      theme: Schema.optionalKey(ThemeSchema),
    }),
  ),
});
export type SettingsFile = typeof SettingsFileSchema.Type;

export const SETTINGS_DEFAULTS: Settings = {
  version: 1,
  appearance: { theme: "system" },
};

export function settingsFromFile(file: SettingsFile): Settings {
  return {
    version: 1,
    appearance: {
      theme: file.appearance?.theme ?? SETTINGS_DEFAULTS.appearance.theme,
    },
  };
}

/** RPC payload: the document plus where it lives on disk. */
export const SettingsViewSchema = Schema.Struct({
  settings: SettingsSchema,
  path: Schema.String,
  exists: Schema.Boolean,
});
export type SettingsView = typeof SettingsViewSchema.Type;

const base = oc.errors(serverErrors);

export const settingsContract = {
  get: base.output(SettingsViewSchema),
  update: base.input(SettingsSchema).output(SettingsViewSchema),
};
