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
    const root = childProcess
      .execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
    return developmentScopeForRoot(root);
  } catch {
    return undefined;
  }
}
