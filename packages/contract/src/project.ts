import { Schema } from "effect";

import { CreateProjectInputSchema, ProjectSchema, serverErrors } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const projectContract = {
  list: oc.output(Schema.Array(ProjectSchema)),
  create: oc.input(CreateProjectInputSchema).output(ProjectSchema),
  /** Create an empty folder under `~/Pie` and register it as a Project. */
  allocateChatProjectDir: base.output(ProjectSchema),
};
