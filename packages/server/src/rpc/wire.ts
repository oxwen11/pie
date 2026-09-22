// oxlint-disable typescript/no-unnecessary-type-parameters -- E preserves the caller's oRPC error constructor
import { Effect } from "effect";

import {
  GitBranchExists,
  GitError,
  GitInvalidBranchName,
  GitInvalidWorktreeKey,
  GitNotRepository,
  GitRefNotFound,
  GitWorktreePathExists,
  ProjectNotFound,
  ScheduleNotFound,
  SessionNotFound,
  StoreReadError,
  StoreWriteError,
  WorkspaceNotDirectory,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import {
  AgentOpenError,
  AgentOperationError,
  AgentUnavailable,
  ExecutableNotFound,
  HarnessSessionNotFound,
  SessionClosed,
  SessionNotResumable,
} from "../harness/errors";

type NotFoundErrors = {
  NOT_FOUND: (input: { message: string }) => unknown;
};

type InternalErrors = {
  INTERNAL: (input: { message: string }) => unknown;
};

type UnsupportedErrors = {
  UNSUPPORTED: (input: { message: string }) => unknown;
};

type InactiveErrors = {
  SESSION_NOT_ACTIVE: (input: { message: string }) => unknown;
};

/** Message-shaped oRPC failures shared by session, schedule, and agent routes. */
export const projectNotFound =
  <E extends NotFoundErrors>(errors: E) =>
  (error: ProjectNotFound) =>
    Effect.fail(errors.NOT_FOUND({ message: `project ${error.projectId} not found` }));

export const sessionNotFound =
  <E extends NotFoundErrors>(errors: E) =>
  (error: SessionNotFound) =>
    Effect.fail(errors.NOT_FOUND({ message: `session ${error.sessionId} not found` }));

export const scheduleNotFound =
  <E extends NotFoundErrors>(errors: E) =>
  (error: ScheduleNotFound) =>
    Effect.fail(errors.NOT_FOUND({ message: `schedule ${error.scheduleId} not found` }));

export const sessionClosed =
  <E extends InactiveErrors>(errors: E) =>
  (error: SessionClosed) =>
    Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${error.sessionId} is closed` }));

export const agentOperation =
  <E extends InternalErrors>(errors: E) =>
  (error: AgentOperationError) =>
    Effect.fail(errors.INTERNAL({ message: error.message }));

export const unsupportedExecutable = <E extends UnsupportedErrors>(errors: E) => ({
  AgentUnavailable: (error: AgentUnavailable) =>
    Effect.fail(errors.UNSUPPORTED({ message: error.message })),
  ExecutableNotFound: (error: ExecutableNotFound) =>
    Effect.fail(errors.UNSUPPORTED({ message: error.message })),
});

export const resumeFailures = <E extends InternalErrors>(errors: E) => ({
  HarnessSessionNotFound: (error: HarnessSessionNotFound) =>
    Effect.fail(errors.INTERNAL({ message: error.message })),
  SessionNotResumable: (error: SessionNotResumable) =>
    Effect.fail(errors.INTERNAL({ message: error.message })),
  AgentOpenError: (error: AgentOpenError) =>
    Effect.fail(errors.INTERNAL({ message: error.message })),
});

export const sessionStoreFailures = <E extends InternalErrors>(errors: E) => ({
  StoreReadError: (error: StoreReadError) =>
    Effect.fail(errors.INTERNAL({ message: `session store read failed: ${error.file}` })),
  StoreWriteError: (error: StoreWriteError) =>
    Effect.fail(errors.INTERNAL({ message: `session store write failed: ${error.file}` })),
});

type LiveAgentErrors = NotFoundErrors & UnsupportedErrors & InternalErrors & InactiveErrors;

/** getMessages / getModelState / setModel share this wire policy. */
export const catchLiveAgent = <E extends LiveAgentErrors>(errors: E) =>
  Effect.catchTags({
    ProjectNotFound: projectNotFound(errors),
    SessionNotFound: sessionNotFound(errors),
    ...unsupportedExecutable(errors),
    ...resumeFailures(errors),
    SessionClosed: sessionClosed(errors),
    AgentOperationError: agentOperation(errors),
  });

export const catchScheduleNotFound = <E extends NotFoundErrors>(errors: E) =>
  Effect.catchTags({
    ScheduleNotFound: scheduleNotFound(errors),
  });

type WorktreeErrors = {
  NOT_FOUND: (input: { message: string }) => unknown;
  CONFLICT: (input: { message: string }) => unknown;
  INVALID_ARGUMENT: (input: { message: string }) => unknown;
  FORBIDDEN: (input: { message: string }) => unknown;
  INTERNAL: (input: { message: string }) => unknown;
};

/** Session routes report git/workspace failures as message strings, not git's data payload. */
export const catchGitWorktree = <E extends WorktreeErrors>(errors: E) =>
  Effect.catchTags({
    GitRefNotFound: (error: GitRefNotFound) =>
      Effect.fail(errors.NOT_FOUND({ message: `git ref ${error.ref} not found` })),
    GitBranchExists: (error: GitBranchExists) =>
      Effect.fail(errors.CONFLICT({ message: `branch ${error.branch} already exists` })),
    GitWorktreePathExists: (error: GitWorktreePathExists) =>
      Effect.fail(errors.CONFLICT({ message: `worktree path ${error.path} already exists` })),
    GitInvalidBranchName: (error: GitInvalidBranchName) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `invalid branch name ${error.branch}` })),
    GitInvalidWorktreeKey: (error: GitInvalidWorktreeKey) =>
      Effect.fail(
        errors.INVALID_ARGUMENT({ message: `invalid worktree key ${error.worktreeKey}` }),
      ),
    GitNotRepository: (error: GitNotRepository) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `${error.cwd} is not a git repository` })),
    WorkspacePathEscape: (error: WorkspacePathEscape) =>
      Effect.fail(errors.FORBIDDEN({ message: `path ${error.path} escapes ${error.cwd}` })),
    WorkspaceNotDirectory: (error: WorkspaceNotDirectory) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `${error.path} is not a directory` })),
    WorkspaceReadError: (error: WorkspaceReadError) =>
      Effect.fail(errors.INTERNAL({ message: `failed to read ${error.path}` })),
    GitError: (error: GitError) =>
      Effect.fail(errors.INTERNAL({ message: `git failed in ${error.cwd}` })),
  });
