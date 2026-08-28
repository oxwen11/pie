import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

export const ThemeSchema = Schema.Literals(["system", "light", "dark"]);
export type Theme = typeof ThemeSchema.Type;

export const SettingsAppearanceSchema = Schema.Struct({
  theme: ThemeSchema,
});
export type SettingsAppearance = typeof SettingsAppearanceSchema.Type;

/** On-disk / wire document for `$PIE_HOME/config.toml`. */
export const SettingsSchema = Schema.Struct({
  appearance: SettingsAppearanceSchema,
});
export type Settings = typeof SettingsSchema.Type;

/** Settings plus the absolute path of the TOML file that stores them. */
export const GetSettingsOutputSchema = Schema.Struct({
  path: Schema.String,
  settings: SettingsSchema,
});
export type GetSettingsOutput = typeof GetSettingsOutputSchema.Type;

const base = oc.errors(serverErrors);

export const settingsContract = {
  get: base.output(GetSettingsOutputSchema),
  update: base.input(SettingsSchema).output(GetSettingsOutputSchema),
};
