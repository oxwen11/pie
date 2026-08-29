import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

export const ThemeSchema = Schema.Literals(["system", "light", "dark"]);
export type Theme = typeof ThemeSchema.Type;

/**
 * Operator UI prefs (`[ui]`). Host `[desktop]` and operator `[agent]` stay off
 * this wire type until the Settings page edits a key in those tables.
 */
export const SettingsUiSchema = Schema.Struct({
  theme: ThemeSchema,
});
export type SettingsUi = typeof SettingsUiSchema.Type;

/**
 * Operator slice of `$PIE_HOME/config.toml`. On disk the file has three owner
 * tables — `[ui]` SPA, `[desktop]` Electron host, `[agent]` operator — but
 * this RPC type is only the `[ui]` slice the Settings page edits.
 */
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
