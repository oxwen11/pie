import type { WorkspaceQuery } from "@getpie/contract";
import type { GitDiffQuery, GitReviewQuery } from "@getpie/contract/git";
import { gitContract } from "@getpie/contract/git";
import { Effect } from "effect";

import {
  GitError,
  GitNotRepository,
  GitRefNotFound,
  WorkspaceBinaryFile,
  WorkspaceFileNotFound,
  WorkspaceFileTooLarge,
  WorkspaceNotDirectory,
  WorkspaceNotFile,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import { GitService } from "../git";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { catchWorkspaceResolveErrors, resolveWorkspaceCwd } from "./resolve-workspace";

const orpc = implement(gitContract).$context<RpcContext>();

const mapGitCwdErrors = <
  E extends {
    PATH_ESCAPE: (input: { data: { cwd: string; path: string } }) => unknown;
    NOT_DIRECTORY: (input: { data: { path: string } }) => unknown;
    GIT_FAILED: (input: { data: { cwd: string } }) => unknown;
    NOT_REPOSITORY: (input: { data: { cwd: string } }) => unknown;
  },
>(
  cwd: string,
  errors: E,
) =>
  Effect.catchTags({
    WorkspacePathEscape: (error: WorkspacePathEscape) =>
      Effect.fail(errors.PATH_ESCAPE({ data: { cwd: error.cwd, path: error.path } })),
    WorkspaceNotDirectory: (error: WorkspaceNotDirectory) =>
      Effect.fail(errors.NOT_DIRECTORY({ data: { path: error.path } })),
    WorkspaceReadError: (_error: WorkspaceReadError) =>
      Effect.fail(errors.GIT_FAILED({ data: { cwd } })),
    GitNotRepository: (error: GitNotRepository) =>
      Effect.fail(errors.NOT_REPOSITORY({ data: { cwd: error.cwd } })),
    GitError: (error: GitError) => Effect.fail(errors.GIT_FAILED({ data: { cwd: error.cwd } })),
  });

const resolveCwd = (
  input: WorkspaceQuery,
  errors: Parameters<typeof catchWorkspaceResolveErrors>[0],
) => resolveWorkspaceCwd(input).pipe(catchWorkspaceResolveErrors(errors));

const toReviewInput = (input: GitReviewQuery, cwd: string) => ({
  cwd,
  ...(input.mode !== undefined ? { mode: input.mode } : undefined),
  ...(input.other !== undefined ? { other: input.other } : undefined),
});

const toDiffInput = (input: GitDiffQuery, cwd: string) => ({
  cwd,
  path: input.path,
  ...(input.mode !== undefined ? { mode: input.mode } : undefined),
  ...(input.other !== undefined ? { other: input.other } : undefined),
});

export const gitRouter = orpc.router({
  status: orpc.status.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    const cwd = yield* resolveCwd(input, errors);
    return yield* git.status(cwd).pipe(mapGitCwdErrors(cwd, errors));
  }),
  branch: orpc.branch.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    const cwd = yield* resolveCwd(input, errors);
    return yield* git.branch(cwd).pipe(mapGitCwdErrors(cwd, errors));
  }),
  review: orpc.review.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    const cwd = yield* resolveCwd(input, errors);
    return yield* git.review(toReviewInput(input, cwd)).pipe(
      mapGitCwdErrors(cwd, errors),
      Effect.catchTags({
        GitRefNotFound: (error: GitRefNotFound) =>
          Effect.fail(errors.REF_NOT_FOUND({ data: { ref: error.ref } })),
      }),
    );
  }),
  diff: orpc.diff.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    const cwd = yield* resolveCwd(input, errors);
    return yield* git.diff(toDiffInput(input, cwd)).pipe(
      mapGitCwdErrors(cwd, errors),
      Effect.catchTags({
        GitRefNotFound: (error: GitRefNotFound) =>
          Effect.fail(errors.REF_NOT_FOUND({ data: { ref: error.ref } })),
        WorkspaceFileNotFound: (error: WorkspaceFileNotFound) =>
          Effect.fail(errors.NOT_FOUND({ data: { path: error.path } })),
        WorkspaceNotFile: (error: WorkspaceNotFile) =>
          Effect.fail(errors.NOT_FOUND({ data: { path: error.path } })),
        WorkspaceBinaryFile: (error: WorkspaceBinaryFile) =>
          Effect.fail(errors.BINARY_FILE({ data: { path: error.path } })),
        WorkspaceFileTooLarge: (error: WorkspaceFileTooLarge) =>
          Effect.fail(
            errors.FILE_TOO_LARGE({
              data: { path: error.path, size: error.size, limit: error.limit },
            }),
          ),
      }),
    );
  }),
});

export type GitRouter = typeof gitRouter;
