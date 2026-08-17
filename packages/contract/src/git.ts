import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { toStandardSchema } from "./domain";

const CwdInput = Schema.Struct({ cwd: Schema.String });
const CwdPathInput = Schema.Struct({
  cwd: Schema.String,
  path: Schema.String,
});

const pathData = toStandardSchema(Schema.Struct({ path: Schema.String }));
const pathEscapeData = toStandardSchema(Schema.Struct({ cwd: Schema.String, path: Schema.String }));
const cwdData = toStandardSchema(Schema.Struct({ cwd: Schema.String }));

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
  defaultBranch: Schema.Union([Schema.String, Schema.Null]),
  branches: Schema.Array(Schema.String),
});
export type GitBranch = typeof GitBranchSchema.Type;

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
 * A local review against the integration branch: three-dot
 * `merge-base(default, HEAD)` plus the working tree. On the default branch
 * (or with no default) the base is `HEAD`, so the set is uncommitted only.
 */
export const GitReviewSchema = Schema.Struct({
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

const cwdErrors = {
  PATH_ESCAPE: { data: pathEscapeData },
  NOT_DIRECTORY: { data: pathData },
  NOT_REPOSITORY: { data: cwdData },
  GIT_FAILED: { data: cwdData },
};

const diffErrors = {
  ...cwdErrors,
  NOT_FOUND: { data: pathData },
  BINARY_FILE: { data: pathData },
  FILE_TOO_LARGE: {
    data: toStandardSchema(
      Schema.Struct({ path: Schema.String, size: Schema.Number, limit: Schema.Number }),
    ),
  },
};

/**
 * Read-only git. Callers pass `cwd`; the server confines paths to that
 * workspace and never writes. `review` / `diff` are the Code Review Panel
 * surface — a change set vs the default branch, not staged/unstaged buckets.
 */
export const gitContract = {
  status: oc
    .input(toStandardSchema(CwdInput))
    .errors(cwdErrors)
    .output(toStandardSchema(GitStatusSchema)),
  branch: oc
    .input(toStandardSchema(CwdInput))
    .errors(cwdErrors)
    .output(toStandardSchema(GitBranchSchema)),
  review: oc
    .input(toStandardSchema(CwdInput))
    .errors(cwdErrors)
    .output(toStandardSchema(GitReviewSchema)),
  diff: oc
    .input(toStandardSchema(CwdPathInput))
    .errors(diffErrors)
    .output(toStandardSchema(GitFileDiffSchema)),
};
