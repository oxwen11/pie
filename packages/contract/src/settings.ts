import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

export const ThemeSchema = Schema.Literals(["system", "light", "dark"]);
export type Theme = typeof ThemeSchema.Type;

/** Operator UI prefs. Host-only keys such as `ui.window` are not on this wire type. */
export const SettingsUiSchema = Schema.Struct({
  theme: ThemeSchema,
});
export type SettingsUi = typeof SettingsUiSchema.Type;

/** Operator slice of `$PIE_HOME/config.toml` (`[ui]`). */
export const SettingsSchema = Schema.Struct({
  ui: SettingsUiSchema,
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
