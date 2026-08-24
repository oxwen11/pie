import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { SessionRefSchema, toStandardSchema } from "./domain";

const CwdInput = Schema.Struct({ cwd: Schema.String });
const SessionRefInput = Schema.Struct({ ref: SessionRefSchema });

export const GitWorkspaceInputSchema = Schema.Union([CwdInput, SessionRefInput]);
export type GitWorkspaceInput = typeof GitWorkspaceInputSchema.Type;

const pathData = toStandardSchema(Schema.Struct({ path: Schema.String }));
const pathEscapeData = toStandardSchema(Schema.Struct({ cwd: Schema.String, path: Schema.String }));
const cwdData = toStandardSchema(Schema.Struct({ cwd: Schema.String }));
const refData = toStandardSchema(Schema.Struct({ ref: Schema.String }));

export const GitStatusFileSchema = Schema.Struct({
  path: Schema.String,
  index: Schema.String,
  worktree: Schema.String,
  oldPath: Schema.optionalKey(Schema.String),
});
export type GitStatusFile = typeof GitStatusFileSchema.Type;

export const GitStatusSchema = Schema.Struct({
  branch: Schema.Union([Schema.String, Schema.Null]),
  files: Schema.Array(GitStatusFileSchema),
});
export type GitStatus = typeof GitStatusSchema.Type;

export const GitBranchSchema = Schema.Struct({
  current: Schema.Union([Schema.String, Schema.Null]),
  /** Preferred compare target: `origin/main` when `origin/HEAD` exists, else local `main`. */
  defaultBranch: Schema.Union([Schema.String, Schema.Null]),
  /** Local heads and remote-tracking refs (`main`, `origin/main`). */
  branches: Schema.Array(Schema.String),
  /** Remote-tracking refs only (`origin/main`). Local names may contain `/`. */
  remotes: Schema.Array(Schema.String),
});
export type GitBranch = typeof GitBranchSchema.Type;

export const GitReviewModeSchema = Schema.Literals(["uncommitted", "committed", "branch"]);
export type GitReviewMode = typeof GitReviewModeSchema.Type;

export const GitReviewQuerySchema = Schema.Union([
  Schema.Struct({
    cwd: Schema.String,
    mode: Schema.optionalKey(GitReviewModeSchema),
    other: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ref: SessionRefSchema,
    mode: Schema.optionalKey(GitReviewModeSchema),
    other: Schema.optionalKey(Schema.String),
  }),
]);
export type GitReviewQuery = typeof GitReviewQuerySchema.Type;

export const GitDiffQuerySchema = Schema.Union([
  Schema.Struct({
    cwd: Schema.String,
    path: Schema.String,
    mode: Schema.optionalKey(GitReviewModeSchema),
    other: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ref: SessionRefSchema,
    path: Schema.String,
    mode: Schema.optionalKey(GitReviewModeSchema),
    other: Schema.optionalKey(Schema.String),
  }),
]);
export type GitDiffQuery = typeof GitDiffQuerySchema.Type;

export const GitReviewFileStatusSchema = Schema.Literals([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
]);
export type GitReviewFileStatus = typeof GitReviewFileStatusSchema.Type;

export const GitReviewFileSchema = Schema.Struct({
  path: Schema.String,
  status: GitReviewFileStatusSchema,
  oldPath: Schema.optionalKey(Schema.String),
});
export type GitReviewFile = typeof GitReviewFileSchema.Type;

/**
 * A change set for the Review panel. `mode` chooses uncommitted vs HEAD,
 * committed three-dot vs the default branch, or three-dot vs `other`
 * (a local or remote-tracking ref).
 */
export const GitReviewSchema = Schema.Struct({
  mode: GitReviewModeSchema,
  other: Schema.Union([Schema.String, Schema.Null]),
  branch: Schema.Union([Schema.String, Schema.Null]),
  base: Schema.String,
  baseBranch: Schema.Union([Schema.String, Schema.Null]),
  files: Schema.Array(GitReviewFileSchema),
});
export type GitReview = typeof GitReviewSchema.Type;

export const GitFileDiffSchema = Schema.Struct({
  path: Schema.String,
  status: GitReviewFileStatusSchema,
  oldPath: Schema.optionalKey(Schema.String),
  oldContents: Schema.Union([Schema.String, Schema.Null]),
  newContents: Schema.Union([Schema.String, Schema.Null]),
  binary: Schema.Boolean,
});
export type GitFileDiff = typeof GitFileDiffSchema.Type;

export const GitWorktreeCreateInputSchema = Schema.Struct({
  cwd: Schema.String,
  branch: Schema.optionalKey(Schema.NonEmptyString),
});
export type GitWorktreeCreateInput = typeof GitWorktreeCreateInputSchema.Type;

export const GitWorktreeCreateResultSchema = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  worktreeKey: Schema.String,
});
export type GitWorktreeCreateResult = typeof GitWorktreeCreateResultSchema.Type;

export const GitWorktreeRemoveInputSchema = Schema.Struct({
  path: Schema.String,
});
export type GitWorktreeRemoveInput = typeof GitWorktreeRemoveInputSchema.Type;

const cwdErrors = {
  PATH_ESCAPE: { data: pathEscapeData },
  NOT_DIRECTORY: { data: pathData },
  NOT_REPOSITORY: { data: cwdData },
  GIT_FAILED: { data: cwdData },
  SESSION_NOT_FOUND: {
    data: toStandardSchema(Schema.Struct({ message: Schema.String })),
  },
};

const reviewErrors = {
  ...cwdErrors,
  REF_NOT_FOUND: { data: refData },
};

const diffErrors = {
  ...reviewErrors,
  NOT_FOUND: { data: pathData },
  BINARY_FILE: { data: pathData },
  FILE_TOO_LARGE: {
    data: toStandardSchema(
      Schema.Struct({ path: Schema.String, size: Schema.Number, limit: Schema.Number }),
    ),
  },
};

const worktreeErrors = {
  ...cwdErrors,
  INVALID_BRANCH: {
    data: toStandardSchema(Schema.Struct({ branch: Schema.String })),
  },
  BRANCH_EXISTS: {
    data: toStandardSchema(Schema.Struct({ cwd: Schema.String, branch: Schema.String })),
  },
  WORKTREE_EXISTS: {
    data: toStandardSchema(Schema.Struct({ cwd: Schema.String, path: Schema.String })),
  },
};

/**
 * Read-only git. Each call takes either an absolute `cwd` or a session `ref`;
 * the server resolves `ref` to the session workspace path. Paths are confined
 * to that workspace and git never writes except via explicit worktree RPCs.
 */
export const gitContract = {
  status: oc
    .input(toStandardSchema(GitWorkspaceInputSchema))
    .errors(cwdErrors)
    .output(toStandardSchema(GitStatusSchema)),
  branch: oc
    .input(toStandardSchema(GitWorkspaceInputSchema))
    .errors(cwdErrors)
    .output(toStandardSchema(GitBranchSchema)),
  review: oc
    .input(toStandardSchema(GitReviewQuerySchema))
    .errors(reviewErrors)
    .output(toStandardSchema(GitReviewSchema)),
  diff: oc
    .input(toStandardSchema(GitDiffQuerySchema))
    .errors(diffErrors)
    .output(toStandardSchema(GitFileDiffSchema)),
  worktreeCreate: oc
    .input(toStandardSchema(GitWorktreeCreateInputSchema))
    .errors(worktreeErrors)
    .output(toStandardSchema(GitWorktreeCreateResultSchema)),
  worktreeRemove: oc.input(toStandardSchema(GitWorktreeRemoveInputSchema)).errors(cwdErrors),
};
