import "@orpc/experimental-effect/extensions/effect";
import { projectContract } from "@getpie/contract/project";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { ProjectRemoval, ProjectService } from "../project";
import type { RpcContext } from "./context";

const orpc = implement(projectContract).$context<RpcContext>();

export const projectRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const projects = yield* ProjectService;
    return yield* projects.list();
  }),
  create: orpc.create.effect(function* ({ input }) {
    const projects = yield* ProjectService;
    return yield* projects.create(input);
  }),
  remove: orpc.remove.effect(function* ({ input, errors }) {
    const removal = yield* ProjectRemoval;
    return yield* removal.remove(input.projectId).pipe(
      Effect.catchTags({
        ProjectNotFound: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${error.projectId} not found` })),
        ProjectSessionsBusy: () =>
          Effect.fail(
            errors.CONFLICT({
              message: `project ${input.projectId} has sessions with accepted work`,
            }),
          ),
      }),
    );
  }),
});

export type ProjectRouter = typeof projectRouter;
