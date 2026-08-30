import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  type GitHashDaemonCompatibilityKey,
  makeGitHashDaemonCompatibilityKey,
} from "./compatibility";

export type ResolveDaemonCompatibilityKeyOptions = {
  readonly cwd?: string;
};

// Keep this intentionally broad: every workspace package may be bundled into
// the standalone server/CLI/Desktop main artifacts. The only excluded app code
// is renderer-only UI, whose output cannot change the daemon protocol or
// lifecycle implementation.
const COMPATIBILITY_INPUTS = [
  "packages",
  "apps/desktop/src/main",
  "apps/desktop/src/shared",
  "apps/desktop/package.json",
  "apps/desktop/electron.vite.config.ts",
  "apps/desktop/electron-builder.yml",
  "apps/desktop/tsconfig.node.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tools",
] as const;

/**
 * Resolve the compatibility key embedded by build configurations.
 *
 * A clean checkout uses Git HEAD directly. A dirty checkout hashes HEAD, the
 * tracked diff, and untracked file contents through Git's object hasher so a
 * rebuilt development artifact cannot silently reuse a daemon from an older
 * worktree state. Either path produces the same `githash:<8-hex>` vocabulary.
 */
export function resolveDaemonCompatibilityKey(
  options: ResolveDaemonCompatibilityKeyOptions = {},
): GitHashDaemonCompatibilityKey {
  const cwd = options.cwd ?? process.cwd();
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const trackedDiff = childProcess.execFileSync(
    "git",
    ["diff", "--binary", "HEAD", "--", ...COMPATIBILITY_INPUTS],
    {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const untracked = childProcess.execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...COMPATIBILITY_INPUTS],
    {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (trackedDiff.length === 0 && untracked.length === 0) {
    return makeGitHashDaemonCompatibilityKey(head);
  }

  const parts: Buffer[] = [Buffer.from(`${head}\0`, "utf8"), trackedDiff];
  for (const relativePath of untracked.toString("utf8").split("\0").filter(Boolean).sort()) {
    parts.push(
      Buffer.from(`\0${relativePath}\0`, "utf8"),
      fs.readFileSync(path.join(root, relativePath)),
    );
  }
  const stateHash = childProcess
    .execFileSync("git", ["hash-object", "--stdin"], {
      cwd: root,
      input: Buffer.concat(parts),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    .trim();
  return makeGitHashDaemonCompatibilityKey(stateHash);
}

function git(cwd: string, args: readonly string[]): string {
  try {
    return childProcess
      .execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      .trim();
  } catch (cause) {
    throw new Error("A Git checkout is required to build Pie", { cause });
  }
}
