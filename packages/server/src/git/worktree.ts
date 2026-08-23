import crypto from "node:crypto";
import path from "node:path";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const MAX_BRANCH_NAME_LENGTH = 244;
const WORKTREE_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

export const isValidBranchName = (branch: string): boolean =>
  branch.length > 0 && branch.length <= MAX_BRANCH_NAME_LENGTH && BRANCH_NAME_PATTERN.test(branch);

export const isValidWorktreeId = (worktreeId: string): boolean =>
  worktreeId.length > 0 && WORKTREE_ID_PATTERN.test(worktreeId);

const sanitizePathSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";

/** Stable directory name grouping worktrees for one repository under `$PIE_HOME/worktrees/`. */
export const repoWorktreeGroupKey = (repoRoot: string): string => {
  const base = sanitizePathSegment(path.basename(repoRoot));
  const hash = crypto.createHash("sha256").update(repoRoot).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
};

/** Worktree checkout path — keyed by session/worktree id, not branch name. */
export const worktreeDirectory = (pieHome: string, repoRoot: string, worktreeId: string): string =>
  path.join(pieHome, "worktrees", repoWorktreeGroupKey(repoRoot), worktreeId);

export const generateWorktreeBranchName = (suffix: string): string => `pie/${suffix}`;
