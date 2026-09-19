import { Schema } from "effect";

import {
  CreateProjectInputSchema,
  NewProjectRootSchema,
  ProjectSchema,
  serverErrors,
} from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const projectContract = {
  list: oc.output(Schema.Array(ProjectSchema)),
  create: oc.input(CreateProjectInputSchema).output(ProjectSchema),
  /** Create an empty folder under the new-project root and register it as a Project. */
  allocate: base.output(ProjectSchema),
  allocateRoot: oc.output(NewProjectRootSchema),
};
