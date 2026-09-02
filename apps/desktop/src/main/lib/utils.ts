import path from "node:path";

import { app } from "electron";

/** Path under the OS temp dir, prefixed `pie-desktop-`, for throwaway data. */
export function pieTempPath(name: string): string {
  return path.join(app.getPath("temp"), `pie-desktop-${name}`);
}

/**
 * userData dir for a dev checkout. Lives in `Pie Dev/<worktree>`, a sibling
 * of the packaged app's userData dir (`Pie`) — not the generic `desktop` dir
 * the dev app name would otherwise produce, and separate from prod so the two
 * don't share a single-instance lock. `scope` is the canonical checkout
 * identity; outside a checkout it falls back to a shared `default` dir.
 */
export function devUserDataPath(scope: string | undefined): string {
  return path.join(app.getPath("appData"), "Pie Dev", scope ?? "default");
}
