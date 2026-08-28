import { Schema } from "effect";

import { CreateProjectInputSchema, ProjectSchema } from "./domain";
import { oc } from "./orpc";

export const projectContract = {
  list: oc.output(Schema.Array(ProjectSchema)),
  create: oc.input(CreateProjectInputSchema).output(ProjectSchema),
};
