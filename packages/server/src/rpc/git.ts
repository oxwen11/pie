import "@orpc/experimental-effect/extensions/effect";
import type { GitDiffQuery, GitReviewQuery, GitWorkspaceInput } from "@getpie/contract/git";
import { gitContract } from "@getpie/contract/git";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import {
  GitBranchExists,
  GitError,
  GitInvalidBranchName,
  GitNotRepository,
  GitRefNotFound,
  GitWorktreePathExists,
  ProjectNotFound,
  SessionNotFound,
  StoreReadError,
  StoreWriteError,
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
import { resolveGitWorkspaceCwd } from "./resolve-git-workspace";

const orpc = implement(gitContract).$context<RpcContext>();

const resolveSessionErrors = <
  E extends { SESSION_NOT_FOUND: (input: { data: { message: string } }) => unknown },
>(
  errors: E,
) =>
  Effect.catchTags({
    SessionNotFound: (error: SessionNotFound) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `session ${error.sessionId} not found` },
        }),
      ),
    ProjectNotFound: (error: ProjectNotFound) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `project ${error.projectId} not found` },
        }),
      ),
    StoreReadError: (error: StoreReadError) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `session store read failed: ${error.file}` },
        }),
      ),
    StoreWriteError: (error: StoreWriteError) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `session store write failed: ${error.file}` },
        }),
      ),
  });

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

const resolveCwd = (input: GitWorkspaceInput, errors: Parameters<typeof resolveSessionErrors>[0]) =>
  resolveGitWorkspaceCwd(input).pipe(resolveSessionErrors(errors));

const toReviewInput = (input: GitReviewQuery, cwd: string) => ({
  cwd,
  ...(input.mode !== undefined ? { mode: input.mode } : {}),
  ...(input.other !== undefined ? { other: input.other } : {}),
});

const toDiffInput = (input: GitDiffQuery, cwd: string) => ({
  cwd,
  path: input.path,
  ...(input.mode !== undefined ? { mode: input.mode } : {}),
  ...(input.other !== undefined ? { other: input.other } : {}),
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
  worktreeCreate: orpc.worktreeCreate.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    return yield* git
      .worktreeCreate(input.cwd, input.branch !== undefined ? { branch: input.branch } : undefined)
      .pipe(
        Effect.catchTags({
          WorkspacePathEscape: (error: WorkspacePathEscape) =>
            Effect.fail(errors.PATH_ESCAPE({ data: { cwd: error.cwd, path: error.path } })),
          WorkspaceNotDirectory: (error: WorkspaceNotDirectory) =>
            Effect.fail(errors.NOT_DIRECTORY({ data: { path: error.path } })),
          WorkspaceReadError: (_error: WorkspaceReadError) =>
            Effect.fail(errors.GIT_FAILED({ data: { cwd: input.cwd } })),
          GitNotRepository: (error: GitNotRepository) =>
            Effect.fail(errors.NOT_REPOSITORY({ data: { cwd: error.cwd } })),
          GitError: (error: GitError) =>
            Effect.fail(errors.GIT_FAILED({ data: { cwd: error.cwd } })),
          GitInvalidBranchName: (error: GitInvalidBranchName) =>
            Effect.fail(errors.INVALID_BRANCH({ data: { branch: error.branch } })),
          GitBranchExists: (error: GitBranchExists) =>
            Effect.fail(errors.BRANCH_EXISTS({ data: { cwd: error.cwd, branch: error.branch } })),
          GitWorktreePathExists: (error: GitWorktreePathExists) =>
            Effect.fail(errors.WORKTREE_EXISTS({ data: { cwd: error.cwd, path: error.path } })),
        }),
      );
  }),
  worktreeRemove: orpc.worktreeRemove.effect(function* ({ input, errors }) {
    const git = yield* GitService;
    yield* git.worktreeRemove(input.path).pipe(
      Effect.catchTags({
        WorkspacePathEscape: (error: WorkspacePathEscape) =>
          Effect.fail(errors.PATH_ESCAPE({ data: { cwd: error.cwd, path: error.path } })),
        WorkspaceNotDirectory: (error: WorkspaceNotDirectory) =>
          Effect.fail(errors.NOT_DIRECTORY({ data: { path: error.path } })),
        WorkspaceReadError: (_error: WorkspaceReadError) =>
          Effect.fail(errors.GIT_FAILED({ data: { cwd: input.path } })),
        GitNotRepository: (error: GitNotRepository) =>
          Effect.fail(errors.NOT_REPOSITORY({ data: { cwd: error.cwd } })),
        GitError: (_error: GitError) =>
          Effect.fail(errors.GIT_FAILED({ data: { cwd: input.path } })),
      }),
    );
  }),
});

export type GitRouter = typeof gitRouter;
