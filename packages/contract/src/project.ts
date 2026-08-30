import { oc } from "@orpc/contract";
import { Schema } from "effect";

import {
  CreateProjectInputSchema,
  ProjectSchema,
  RemoveProjectInputSchema,
  serverErrors,
  toStandardSchema,
} from "./domain";

const base = oc.errors(serverErrors);

export const projectContract = {
  list: oc.output(toStandardSchema(Schema.Array(ProjectSchema))),
  create: oc
    .input(toStandardSchema(CreateProjectInputSchema))
    .output(toStandardSchema(ProjectSchema)),
  remove: base.input(toStandardSchema(RemoveProjectInputSchema)),
};
