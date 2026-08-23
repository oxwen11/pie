import path from "node:path";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const MAX_BRANCH_NAME_LENGTH = 244;

export const isValidBranchName = (branch: string): boolean =>
  branch.length > 0 && branch.length <= MAX_BRANCH_NAME_LENGTH && BRANCH_NAME_PATTERN.test(branch);

export const sanitizeBranchForPath = (branch: string): string =>
  branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";

export const worktreeDirectoryForBranch = (repoRoot: string, branch: string): string =>
  path.join(repoRoot, ".pie", "worktrees", sanitizeBranchForPath(branch));

export const generateWorktreeBranchName = (suffix: string): string => `pie/${suffix}`;
