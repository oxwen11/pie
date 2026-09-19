import { Schema } from "effect";

import { oc } from "./orpc";

export const PanelPluginSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
});
export type PanelPlugin = typeof PanelPluginSchema.Type;

export const pluginContract = {
  list: oc.output(Schema.Array(PanelPluginSchema)),
};
