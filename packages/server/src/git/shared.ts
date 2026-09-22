import path from "node:path";

import { Effect, FileSystem } from "effect";
import { simpleGit } from "simple-git";

import { GitError, GitNotRepository } from "../errors";
import { resolveWorkspaceRoot, workspaceReadError } from "../workspace-root";

/** Reject anything that is not a listed ref name — no `../`, flags, or rev magic. */
export const isUnsafeRef = (ref: string): boolean =>
  ref === "" ||
  ref.startsWith("-") ||
  ref.includes("..") ||
  ref.includes("\\") ||
  ref.includes("\0") ||
  ref.includes(":") ||
  ref.includes("@{") ||
  /\s/.test(ref);

export const parseRefNames = (output: string) => {
  const local: string[] = [];
  const remotes: string[] = [];
  for (const line of output.split("\n")) {
    const ref = line.trim();
    if (ref.startsWith("refs/heads/")) {
      local.push(ref.slice("refs/heads/".length));
    } else if (ref.startsWith("refs/remotes/")) {
      remotes.push(ref.slice("refs/remotes/".length));
    }
  }
  return { local, remotes, all: [...local, ...remotes] };
};

const isNotRepositoryMessage = (cause: unknown): boolean => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /not a git repository/i.test(message);
};

export const makeGitHelpers = (fs: FileSystem.FileSystem) => {
  const readError = workspaceReadError;

  const gitError = (cwd: string) => (cause: unknown) =>
    isNotRepositoryMessage(cause) ? new GitNotRepository({ cwd }) : new GitError({ cwd, cause });

  const raw = (cwd: string, args: readonly string[]) =>
    Effect.tryPromise({
      try: () => simpleGit(cwd).raw([...args]),
      catch: gitError(cwd),
    });

  const resolveRoot = resolveWorkspaceRoot(fs);

  const resolveRepoRoot = (cwd: string) =>
    raw(cwd, ["rev-parse", "--show-toplevel"]).pipe(
      Effect.map((value) => value.trim()),
      Effect.flatMap((toplevel) =>
        toplevel === ""
          ? Effect.fail(new GitNotRepository({ cwd }))
          : Effect.succeed(path.resolve(toplevel)),
      ),
    );

  const listRefs = (cwd: string) =>
    raw(cwd, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]).pipe(
      Effect.map(parseRefNames),
    );

  return { readError, gitError, raw, resolveRoot, resolveRepoRoot, listRefs };
};
