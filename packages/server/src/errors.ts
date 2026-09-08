import { Schema } from "effect";

/** Typed errors. All domain failures flow through the Effect error channel. */

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.String,
}) {}

export class ScheduleNotFound extends Schema.TaggedError<ScheduleNotFound>()("ScheduleNotFound", {
  scheduleId: Schema.String,
}) {}

export class ScheduleLimitReached extends Schema.TaggedError<ScheduleLimitReached>()(
  "ScheduleLimitReached",
  {
    limit: Schema.Number,
  },
) {}

export class InvalidSchedule extends Schema.TaggedError<InvalidSchedule>()("InvalidSchedule", {
  reason: Schema.String,
}) {}

export class StoreReadError extends Schema.TaggedError<StoreReadError>()("StoreReadError", {
  file: Schema.String,
  cause: Schema.Defect(),
}) {}

export class StoreWriteError extends Schema.TaggedError<StoreWriteError>()("StoreWriteError", {
  file: Schema.String,
  cause: Schema.Defect(),
}) {}

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  cwd: Schema.String,
  cause: Schema.Defect(),
}) {}

/** `cwd` is not inside a Git work tree. */
export class GitNotRepository extends Schema.TaggedError<GitNotRepository>()("GitNotRepository", {
  cwd: Schema.String,
}) {}

/** `other` is not a local head or remote-tracking ref in this repository. */
export class GitRefNotFound extends Schema.TaggedError<GitRefNotFound>()("GitRefNotFound", {
  ref: Schema.String,
}) {}

/** A git branch name failed validation before worktree creation. */
export class GitInvalidBranchName extends Schema.TaggedError<GitInvalidBranchName>()(
  "GitInvalidBranchName",
  {
    branch: Schema.String,
  },
) {}

/** A worktree directory key failed validation before worktree creation. */
export class GitInvalidWorktreeKey extends Schema.TaggedError<GitInvalidWorktreeKey>()(
  "GitInvalidWorktreeKey",
  {
    worktreeKey: Schema.String,
  },
) {}

/** The requested branch already exists in the repository. */
export class GitBranchExists extends Schema.TaggedError<GitBranchExists>()("GitBranchExists", {
  cwd: Schema.String,
  branch: Schema.String,
}) {}

/** The worktree path is already occupied. */
export class GitWorktreePathExists extends Schema.TaggedError<GitWorktreePathExists>()(
  "GitWorktreePathExists",
  {
    cwd: Schema.String,
    path: Schema.String,
  },
) {}

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", {
  projectId: Schema.String,
  sessionId: Schema.String,
}) {}

/** A SessionRef's projectId disagrees with the stored session metadata. */
export class SessionRefMismatch extends Schema.TaggedError<SessionRefMismatch>()(
  "SessionRefMismatch",
  {
    projectId: Schema.String,
    sessionId: Schema.String,
  },
) {}

/** No stored session matches a bare sessionId during reverse lookup. */
export class SessionRefNotFound extends Schema.TaggedError<SessionRefNotFound>()(
  "SessionRefNotFound",
  {
    sessionId: Schema.String,
  },
) {}

/** A prompt carried a part type this server cannot yet forward (e.g. `file`). */
export class UnsupportedPromptPart extends Schema.TaggedError<UnsupportedPromptPart>()(
  "UnsupportedPromptPart",
  {
    kind: Schema.String,
  },
) {}

/** A requested path resolves outside its `cwd` (via `..` or a symlink). */
export class WorkspacePathEscape extends Schema.TaggedError<WorkspacePathEscape>()(
  "WorkspacePathEscape",
  {
    cwd: Schema.String,
    path: Schema.String,
  },
) {}

/** The requested workspace path no longer exists. */
export class WorkspaceFileNotFound extends Schema.TaggedError<WorkspaceFileNotFound>()(
  "WorkspaceFileNotFound",
  {
    path: Schema.String,
  },
) {}

/** The path exists but is not a regular file (e.g. a directory). */
export class WorkspaceNotFile extends Schema.TaggedError<WorkspaceNotFile>()("WorkspaceNotFile", {
  path: Schema.String,
}) {}

/** The path exists but is not a directory (e.g. a regular file). */
export class WorkspaceNotDirectory extends Schema.TaggedError<WorkspaceNotDirectory>()(
  "WorkspaceNotDirectory",
  {
    path: Schema.String,
  },
) {}

/** The file is larger than the read limit; rejected rather than truncated. */
export class WorkspaceFileTooLarge extends Schema.TaggedError<WorkspaceFileTooLarge>()(
  "WorkspaceFileTooLarge",
  {
    path: Schema.String,
    size: Schema.Number,
    limit: Schema.Number,
  },
) {}

/** The file contains a NUL byte, so we treat it as binary and refuse to read it as text. */
export class WorkspaceBinaryFile extends Schema.TaggedError<WorkspaceBinaryFile>()(
  "WorkspaceBinaryFile",
  {
    path: Schema.String,
  },
) {}

/** An underlying `FileSystem` read failed (missing, permission, etc.). */
export class WorkspaceReadError extends Schema.TaggedError<WorkspaceReadError>()(
  "WorkspaceReadError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}
