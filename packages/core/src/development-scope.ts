import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function developmentScopeForRoot(root: string): string {
  const canonicalRoot = fs.realpathSync(root);
  const basename = path
    .basename(canonicalRoot)
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^[-.]+|[-.]+$/g, "");
  const hash = crypto.createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 8);
  return `${basename || "worktree"}-${hash}`;
}

export function resolveDevelopmentScope(cwd = process.cwd()): string | undefined {
  try {
    return developmentScopeForRoot(git(cwd, ["rev-parse", "--show-toplevel"]));
  } catch {
    return undefined;
  }
}

export type GitCheckout =
  | { readonly inGit: false }
  | { readonly inGit: true; readonly branch: string | undefined };

/** Whether `cwd` is inside a Git work tree, and which branch (or detached SHA). */
export function resolveGitCheckout(cwd = process.cwd()): GitCheckout {
  try {
    const current = git(cwd, ["branch", "--show-current"]);
    if (current !== "") return { inGit: true, branch: current };
    try {
      return { inGit: true, branch: git(cwd, ["rev-parse", "--short=8", "HEAD"]) };
    } catch {
      return { inGit: true, branch: undefined };
    }
  } catch {
    return { inGit: false };
  }
}

function git(cwd: string, args: string[]): string {
  return childProcess
    .execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    .trim();
}
