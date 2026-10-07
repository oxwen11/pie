import { Schema } from "effect";
import { mcp } from "orpc-mcp";

import { CreateProjectInputSchema, ProjectSchema, serverErrors } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const projectContract = {
  ls: oc
    .meta(mcp.tool({ name: "project_ls", description: "List registered projects" }))
    .output(Schema.Array(ProjectSchema)),
  create: oc
    .meta(mcp.tool({ name: "project_create", description: "Register a project directory" }))
    .input(CreateProjectInputSchema)
    .output(ProjectSchema),
  /** Create an empty folder under `~/Pie` and register it as a Project. */
  allocateChatProjectDir: base.output(ProjectSchema),
};
