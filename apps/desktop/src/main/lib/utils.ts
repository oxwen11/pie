import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Effect } from "effect";
import { app } from "electron";

/** Path under the OS temp dir, prefixed `pie-desktop-`, for throwaway data. */
export function pieTempPath(name: string): string {
  return path.join(app.getPath("temp"), `pie-desktop-${name}`);
}

/**
 * userData dir for a dev checkout. Lives in `Pie Dev/<worktree>`, a sibling
 * of the packaged app's userData dir (`Pie`) — not the generic `desktop` dir
 * the dev app name would otherwise produce, and separate from prod so the two
 * don't share a single-instance lock. The mise dev environment supplies its
 * hashed worktree scope; direct Electron invocations derive the same identity,
 * or fall back to a shared `default` dir outside a checkout.
 */
export function devUserDataPath(scope: string | undefined): string {
  return path.join(app.getPath("appData"), "Pie Dev", scope ?? "default");
}

/**
 * Stable path segment for the current git worktree (e.g.
 * `dapper-mochi-a1b2c3d4`). Used to key each dev checkout's userData dir. The
 * readable basename is paired with a hash of the canonical root so equal
 * basenames in separate clones cannot collide. Not `basename(cwd)` — dev's cwd
 * is `apps/desktop`, identical across worktrees. Succeeds with undefined outside
 * a git checkout. Synchronous so it can run in the pre-`whenReady` bootstrap.
 */
export const devWorktreeSlug: Effect.Effect<string | undefined> = Effect.try(() => {
  const root = childProcess
    .execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    .trim();
  const canonicalRoot = fs.realpathSync(root);
  const basename = path
    .basename(canonicalRoot)
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^[-.]+|[-.]+$/g, "");
  const hash = crypto.createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 8);
  return `${basename || "worktree"}-${hash}`;
}).pipe(Effect.catch(() => Effect.succeed(undefined)));
