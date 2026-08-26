import path from "node:path";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const MAX_BRANCH_NAME_LENGTH = 244;
const WORKTREE_KEY_PATTERN = /^[a-z0-9]{4}$/;

export const isValidBranchName = (branch: string): boolean =>
  branch.length > 0 && branch.length <= MAX_BRANCH_NAME_LENGTH && BRANCH_NAME_PATTERN.test(branch);

export const isValidWorktreeKey = (worktreeKey: string): boolean =>
  WORKTREE_KEY_PATTERN.test(worktreeKey);

const sanitizePathSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";

/** Repository folder name under `$PIE_HOME/worktrees/` (e.g. `pie`). */
export const repoWorktreeGroupKey = (repoRoot: string): string =>
  sanitizePathSegment(path.basename(path.resolve(repoRoot)));

export const generateWorktreeBranchName = (suffix: string): string => `pie/${suffix}`;

/** `$PIE_HOME/worktrees/<repo>/<worktreeKey>/` — `worktreesDir` comes from `Paths`. */
export const worktreeDirectory = (
  worktreesDir: string,
  repoRoot: string,
  worktreeKey: string,
): string => path.join(worktreesDir, repoWorktreeGroupKey(repoRoot), worktreeKey);
