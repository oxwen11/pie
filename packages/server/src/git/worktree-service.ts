import path from "node:path";

import { Context, Crypto, Effect, Encoding, FileSystem, Layer } from "effect";
import { simpleGit } from "simple-git";

import { Paths } from "../config/paths";
import {
  GitBranchExists,
  GitInvalidBranchName,
  GitInvalidWorktreeKey,
  GitRefNotFound,
  GitWorktreePathExists,
  WorkspacePathEscape,
} from "../errors";
import { contains } from "../path-safety";
import type { GitFailure } from "./service";
import { isUnsafeRef, makeGitHelpers } from "./shared";
import {
  generateWorktreeBranchName,
  isValidBranchName,
  isValidWorktreeKey,
  worktreeDirectory,
} from "./worktree";

export type GitWorktreeCreateResult = {
  readonly path: string;
  readonly branch: string;
};

export type GitWorktreeFailure =
  | GitFailure
  | GitInvalidBranchName
  | GitInvalidWorktreeKey
  | GitBranchExists
  | GitWorktreePathExists
  | GitRefNotFound;

const WORKTREE_KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const WORKTREE_KEY_LENGTH = 4;
const WORKTREE_KEY_BYTE_LIMIT =
  Math.floor(256 / WORKTREE_KEY_ALPHABET.length) * WORKTREE_KEY_ALPHABET.length;

const dieRng = (what: string) => (cause: unknown) =>
  Effect.die(new Error(`invariant: platform RNG failed minting a ${what}`, { cause }));

export class WorktreeService extends Context.Service<
  WorktreeService,
  {
    readonly create: (
      cwd: string,
      input?: { readonly base?: string },
    ) => Effect.Effect<GitWorktreeCreateResult, GitWorktreeFailure>;
    readonly remove: (path: string) => Effect.Effect<void, GitFailure>;
  }
>()("WorktreeService") {}

export const WorktreeServiceLayer: Layer.Layer<
  WorktreeService,
  never,
  FileSystem.FileSystem | Paths | Crypto.Crypto
> = Layer.effect(
  WorktreeService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Paths;
    const crypto = yield* Crypto.Crypto;
    const { readError, gitError, resolveRoot, resolveRepoRoot, listRefs } = makeGitHelpers(fs);

    const generateWorktreeKey = (): Effect.Effect<string> =>
      Effect.gen(function* () {
        const chars: string[] = [];
        while (chars.length < WORKTREE_KEY_LENGTH) {
          const bytes = yield* crypto
            .randomBytes(WORKTREE_KEY_LENGTH * 2)
            .pipe(Effect.catchTag("PlatformError", dieRng("worktree key")));
          for (const byte of bytes) {
            if (byte >= WORKTREE_KEY_BYTE_LIMIT) continue;
            const next = WORKTREE_KEY_ALPHABET[byte % WORKTREE_KEY_ALPHABET.length];
            if (next === undefined) continue;
            chars.push(next);
            if (chars.length === WORKTREE_KEY_LENGTH) break;
          }
        }
        return chars.join("");
      });

    const generateWorktreeBranch = (): Effect.Effect<string> =>
      crypto
        .randomBytes(4)
        .pipe(
          Effect.map(Encoding.encodeHex),
          Effect.map(generateWorktreeBranchName),
          Effect.catchTag("PlatformError", dieRng("worktree branch")),
        );

    return {
      create: (cwd, input) =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          const repoRoot = yield* resolveRepoRoot(realRoot);
          const startPoint = input?.base ?? "HEAD";
          if (input?.base !== undefined && isUnsafeRef(input.base)) {
            return yield* new GitRefNotFound({ ref: input.base });
          }

          const worktreeKey = yield* generateWorktreeKey();
          const branch = yield* generateWorktreeBranch();
          if (!isValidWorktreeKey(worktreeKey)) {
            return yield* new GitInvalidWorktreeKey({ worktreeKey });
          }
          if (!isValidBranchName(branch)) {
            return yield* new GitInvalidBranchName({ branch });
          }

          const worktreePath = worktreeDirectory(paths.worktreesDir, repoRoot, worktreeKey);
          if (!contains(paths.worktreesDir, worktreePath)) {
            return yield* new WorkspacePathEscape({ cwd: realRoot, path: worktreePath });
          }
          const exists = yield* fs
            .exists(worktreePath)
            .pipe(Effect.mapError(readError(worktreePath)));
          if (exists) {
            return yield* new GitWorktreePathExists({ cwd: realRoot, path: worktreePath });
          }
          const refs = yield* listRefs(realRoot);
          if (input?.base !== undefined && !refs.all.includes(input.base)) {
            return yield* new GitRefNotFound({ ref: input.base });
          }
          if (refs.all.includes(branch)) {
            return yield* new GitBranchExists({ cwd: realRoot, branch });
          }
          yield* fs
            .makeDirectory(path.dirname(worktreePath), { recursive: true })
            .pipe(Effect.mapError(readError(worktreePath)));
          yield* Effect.tryPromise({
            try: () =>
              simpleGit(repoRoot).raw(["worktree", "add", "-b", branch, worktreePath, startPoint]),
            catch: gitError(realRoot),
          });
          return { path: worktreePath, branch };
        }),

      remove: (worktreePath) =>
        Effect.gen(function* () {
          if (!path.isAbsolute(worktreePath)) {
            return yield* new WorkspacePathEscape({ cwd: worktreePath, path: "." });
          }
          const realPath = yield* fs.realPath(worktreePath).pipe(Effect.mapError(readError(".")));
          const realWorktreesDir = yield* fs
            .realPath(paths.worktreesDir)
            .pipe(Effect.mapError(readError(".")));
          if (!contains(realWorktreesDir, realPath)) {
            return yield* new WorkspacePathEscape({ cwd: paths.worktreesDir, path: worktreePath });
          }
          const repoRoot = yield* resolveRepoRoot(realPath);
          yield* Effect.tryPromise({
            try: () => simpleGit(repoRoot).raw(["worktree", "remove", "--force", realPath]),
            catch: gitError(realPath),
          });
        }),
    };
  }),
);
