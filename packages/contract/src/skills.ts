import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const SkillItemSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.String,
  path: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  scope: Schema.Literals(["user", "project", "temporary"]),
});
export type SkillItem = typeof SkillItemSchema.Type;

export const skillsContract = {
  list: base.output(Schema.Array(SkillItemSchema)),
};
