import { projectContract } from "@getpie/contract/project";
import { Effect } from "effect";

import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

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
  allocateRoot: orpc.allocateRoot.effect(function* () {
    const projects = yield* ProjectService;
    return yield* projects.allocateRoot();
  }),
  allocate: orpc.allocate.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    return yield* projects.allocate(input).pipe(
      Effect.catchTags({
        WorkspaceNotDirectory: (e) =>
          Effect.fail(errors.INVALID_ARGUMENT({ message: `${e.path} is not a directory` })),
        WorkspacePathEscape: (e) =>
          Effect.fail(errors.FORBIDDEN({ message: `path ${e.path} escapes ${e.cwd}` })),
        WorkspaceReadError: (e) =>
          Effect.fail(errors.INTERNAL({ message: `failed to read ${e.path}` })),
        ProjectFolderCreateError: (e) =>
          Effect.fail(errors.INTERNAL({ message: `failed to create folder ${e.path}` })),
        ProjectFolderConflict: (e) =>
          Effect.fail(errors.CONFLICT({ message: `could not allocate a folder under ${e.root}` })),
      }),
    );
  }),
});

export type ProjectRouter = typeof projectRouter;
