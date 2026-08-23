import crypto from "node:crypto";
import path from "node:path";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const MAX_BRANCH_NAME_LENGTH = 244;
const WORKTREE_KEY_PATTERN = /^[a-z0-9]{4}$/;
const WORKTREE_KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const WORKTREE_KEY_LENGTH = 4;

export const isValidBranchName = (branch: string): boolean =>
  branch.length > 0 && branch.length <= MAX_BRANCH_NAME_LENGTH && BRANCH_NAME_PATTERN.test(branch);

export const isValidWorktreeKey = (worktreeKey: string): boolean =>
  WORKTREE_KEY_PATTERN.test(worktreeKey);

const sanitizePathSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";

/** Repository folder name under `$PIE_HOME/worktrees/` (e.g. `pie`). */
export const repoWorktreeGroupKey = (repoRoot: string): string =>
  sanitizePathSegment(path.basename(path.resolve(repoRoot)));

/** Short checkout directory name (e.g. `mv98`), like Cursor's worktree folders. */
export const generateWorktreeKey = (): string => {
  const bytes = crypto.randomBytes(WORKTREE_KEY_LENGTH);
  return Array.from(
    bytes,
    (byte) => WORKTREE_KEY_ALPHABET[byte % WORKTREE_KEY_ALPHABET.length],
  ).join("");
};

/** Default branch suffix (e.g. `a50b231d`), paired with {@link generateWorktreeBranchName}. */
export const generateWorktreeBranchSuffix = (): string => crypto.randomBytes(4).toString("hex");

export const generateWorktreeBranchName = (suffix: string): string => `pie/${suffix}`;

/** `$PIE_HOME/worktrees/<repo>/<worktreeKey>/` */
export const worktreeDirectory = (pieHome: string, repoRoot: string, worktreeKey: string): string =>
  path.join(pieHome, "worktrees", repoWorktreeGroupKey(repoRoot), worktreeKey);
