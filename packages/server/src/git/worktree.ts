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

/**
 * Readable directory name for one repository under `$PIE_HOME/worktrees/`.
 * Uses the resolved absolute path (`/home/user/dev/pie` → `home-user-dev-pie`).
 */
export const repoWorktreeGroupKey = (repoRoot: string): string => {
  const segments = path
    .resolve(repoRoot)
    .split(path.sep)
    .filter((segment) => segment.length > 0);
  const slug = segments.map(sanitizePathSegment).join("-");
  return slug.length > 0 ? slug : "repo";
};

/** Worktree checkout path — keyed by session/worktree id, not branch name. */
export const worktreeDirectory = (pieHome: string, repoRoot: string, worktreeId: string): string =>
  path.join(pieHome, "worktrees", repoWorktreeGroupKey(repoRoot), worktreeId);

export const generateWorktreeBranchName = (suffix: string): string => `pie/${suffix}`;
