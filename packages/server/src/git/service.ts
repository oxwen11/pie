import path from "node:path";

import type {
  GitBranch,
  GitFileDiff,
  GitReview,
  GitReviewFile,
  GitStatus,
  GitStatusFile,
} from "@vibest/contract/git";
import { Context, Effect, FileSystem, Layer } from "effect";
import { simpleGit } from "simple-git";

import {
  GitError,
  GitNotRepository,
  WorkspaceBinaryFile,
  WorkspaceFileNotFound,
  WorkspaceFileTooLarge,
  WorkspaceNotDirectory,
  WorkspaceNotFile,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import { FileSystemService } from "../fs";
import { parseNameStatus, parseNulPaths } from "./name-status";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const NUL_BYTE = 0;
const BINARY_MAGIC_PREFIXES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x25, 0x50, 0x44, 0x46, 0x2d],
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x1f, 0x8b],
  [0x7f, 0x45, 0x4c, 0x46],
];
const DEFAULT_BRANCH_NAMES = ["main", "master", "trunk"] as const;

const contains = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

const hasBinaryMagicPrefix = (bytes: Uint8Array): boolean =>
  BINARY_MAGIC_PREFIXES.some(
    (prefix) =>
      bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte),
  );

const isNotRepositoryMessage = (cause: unknown): boolean => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /not a git repository/i.test(message);
};

const decodeText = (
  bytes: Uint8Array,
  relativePath: string,
): Effect.Effect<string, WorkspaceBinaryFile> => {
  if (bytes.includes(NUL_BYTE) || hasBinaryMagicPrefix(bytes)) {
    return Effect.fail(new WorkspaceBinaryFile({ path: relativePath }));
  }
  try {
    return Effect.succeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return Effect.fail(new WorkspaceBinaryFile({ path: relativePath }));
  }
};

type GitFailure =
  | WorkspacePathEscape
  | WorkspaceNotDirectory
  | WorkspaceReadError
  | GitNotRepository
  | GitError;

type GitDiffFailure =
  | GitFailure
  | WorkspaceFileNotFound
  | WorkspaceNotFile
  | WorkspaceBinaryFile
  | WorkspaceFileTooLarge;

/**
 * Read-only `git` module. Workspace confinement matches `FileSystemService`:
 * `cwd` must be an absolute directory, and every path git reports is rewritten
 * relative to that directory (files outside it are dropped).
 */
export class GitService extends Context.Service<
  GitService,
  {
    readonly status: (cwd: string) => Effect.Effect<GitStatus, GitFailure>;
    readonly branch: (cwd: string) => Effect.Effect<GitBranch, GitFailure>;
    readonly review: (cwd: string) => Effect.Effect<GitReview, GitFailure>;
    readonly diff: (cwd: string, path: string) => Effect.Effect<GitFileDiff, GitDiffFailure>;
  }
>()("GitService") {}

export const GitServiceLayer: Layer.Layer<
  GitService,
  never,
  FileSystem.FileSystem | FileSystemService
> = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workspace = yield* FileSystemService;

    const readError = (relativePath: string) => (cause: unknown) =>
      new WorkspaceReadError({ path: relativePath, cause });

    const resolveRoot = (cwd: string) =>
      Effect.gen(function* () {
        if (!path.isAbsolute(cwd)) {
          return yield* new WorkspacePathEscape({ cwd, path: "." });
        }
        const realRoot = yield* fs.realPath(cwd).pipe(Effect.mapError(readError(".")));
        const info = yield* fs.stat(realRoot).pipe(Effect.mapError(readError(".")));
        if (info.type !== "Directory") {
          return yield* new WorkspaceNotDirectory({ path: "." });
        }
        return realRoot;
      });

    const gitError = (cwd: string) => (cause: unknown) =>
      isNotRepositoryMessage(cause) ? new GitNotRepository({ cwd }) : new GitError({ cwd, cause });

    const raw = (cwd: string, args: readonly string[]) =>
      Effect.tryPromise({
        try: () => simpleGit(cwd).raw([...args]),
        catch: gitError(cwd),
      });

    const resolveRepoRoot = (cwd: string) =>
      raw(cwd, ["rev-parse", "--show-toplevel"]).pipe(
        Effect.map((value) => value.trim()),
        Effect.flatMap((toplevel) =>
          toplevel === ""
            ? Effect.fail(new GitNotRepository({ cwd }))
            : Effect.succeed(path.resolve(toplevel)),
        ),
      );

    const toWorkspacePath = (cwd: string, repoRoot: string, gitPath: string): string | null => {
      if (path.isAbsolute(gitPath) || gitPath.split(/[\\/]/).includes("..")) return null;
      const absolute = path.resolve(repoRoot, gitPath);
      if (!contains(cwd, absolute)) return null;
      return toPosixPath(path.relative(cwd, absolute)) || gitPath;
    };

    const relocate = (cwd: string, repoRoot: string, file: GitReviewFile): GitReviewFile | null => {
      const nextPath = toWorkspacePath(cwd, repoRoot, file.path);
      if (nextPath === null) return null;
      if (file.oldPath === undefined) return { ...file, path: nextPath };
      const oldPath = toWorkspacePath(cwd, repoRoot, file.oldPath);
      if (oldPath === null) return { path: nextPath, status: file.status };
      return { path: nextPath, status: file.status, oldPath };
    };

    const resolveDefaultRef = (cwd: string) =>
      Effect.gen(function* () {
        const remoteHead = yield* raw(cwd, [
          "symbolic-ref",
          "--quiet",
          "refs/remotes/origin/HEAD",
        ]).pipe(
          Effect.map((value) => value.trim()),
          Effect.catch(() => Effect.succeed("")),
        );
        if (remoteHead.startsWith("refs/remotes/")) {
          return remoteHead.slice("refs/remotes/".length);
        }
        const local = yield* raw(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
        const names = new Set(
          local
            .split("\n")
            .map((name) => name.trim())
            .filter(Boolean),
        );
        for (const name of DEFAULT_BRANCH_NAMES) {
          if (names.has(name)) return name;
        }
        return null;
      });

    const shortBranchName = (ref: string): string => ref.replace(/^origin\//, "");

    const isOnDefault = (current: string | null, defaultRef: string): boolean => {
      if (current === null || current === "HEAD") return false;
      return current === defaultRef || current === shortBranchName(defaultRef);
    };

    const resolveReviewBase = (cwd: string, current: string | null) =>
      Effect.gen(function* () {
        const defaultRef = yield* resolveDefaultRef(cwd);
        if (defaultRef === null || isOnDefault(current, defaultRef)) {
          return { base: "HEAD", baseBranch: null as string | null };
        }
        const mergeBase = yield* raw(cwd, ["merge-base", "HEAD", defaultRef]).pipe(
          Effect.map((value) => value.trim()),
          Effect.catch(() => Effect.succeed("")),
        );
        return {
          base: mergeBase === "" ? defaultRef : mergeBase,
          baseBranch: shortBranchName(defaultRef),
        };
      });

    const currentBranch = (cwd: string) =>
      raw(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
        Effect.map((value) => {
          const name = value.trim();
          return name === "" ? null : name;
        }),
      );

    const reviewFiles = (cwd: string, repoRoot: string, base: string) =>
      Effect.gen(function* () {
        const nameStatus = yield* raw(cwd, ["diff", "--name-status", "-z", "--find-renames", base]);
        const tracked = parseNameStatus(nameStatus)
          .map((file) => relocate(cwd, repoRoot, file))
          .filter((file): file is GitReviewFile => file !== null);
        const untrackedRaw = yield* raw(cwd, ["ls-files", "-z", "--others", "--exclude-standard"]);
        const seen = new Set(tracked.map((file) => file.path));
        const files = [...tracked];
        for (const gitPath of parseNulPaths(untrackedRaw)) {
          const nextPath = toWorkspacePath(cwd, repoRoot, gitPath);
          if (nextPath === null || seen.has(nextPath)) continue;
          seen.add(nextPath);
          files.push({ path: nextPath, status: "added" });
        }
        files.sort((left, right) =>
          left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
        );
        return files;
      });

    const readWorktreeText = (cwd: string, relativePath: string) =>
      workspace.readFileString(cwd, relativePath);

    const readBlobText = (cwd: string, base: string, blobPath: string) =>
      Effect.gen(function* () {
        const sizeRaw = yield* raw(cwd, ["cat-file", "-s", `${base}:${blobPath}`]).pipe(
          Effect.catch(() => Effect.succeed("")),
        );
        if (sizeRaw.trim() === "") return null;
        const size = Number(sizeRaw.trim());
        if (Number.isFinite(size) && size > MAX_FILE_BYTES) {
          return yield* new WorkspaceFileTooLarge({
            path: blobPath,
            size,
            limit: MAX_FILE_BYTES,
          });
        }
        const text = yield* raw(cwd, ["cat-file", "-p", `${base}:${blobPath}`]);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          return yield* new WorkspaceFileTooLarge({
            path: blobPath,
            size: bytes.byteLength,
            limit: MAX_FILE_BYTES,
          });
        }
        return yield* decodeText(bytes, blobPath);
      });

    return {
      status: (cwd) =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          const repoRoot = yield* resolveRepoRoot(realRoot);
          const result = yield* Effect.tryPromise({
            try: () => simpleGit(realRoot).status(),
            catch: gitError(realRoot),
          });
          const files: GitStatusFile[] = [];
          for (const file of result.files) {
            const nextPath = toWorkspacePath(realRoot, repoRoot, file.path);
            if (nextPath === null) continue;
            const renameFrom =
              "from" in file && typeof file.from === "string" ? file.from : undefined;
            const relocatedFrom =
              renameFrom === undefined
                ? undefined
                : toWorkspacePath(realRoot, repoRoot, renameFrom);
            files.push({
              path: nextPath,
              index: file.index,
              worktree: file.working_dir,
              ...(relocatedFrom === undefined || relocatedFrom === null
                ? {}
                : { oldPath: relocatedFrom }),
            });
          }
          return { branch: result.current ?? null, files };
        }),

      branch: (cwd) =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          const current = yield* currentBranch(realRoot);
          const defaultRef = yield* resolveDefaultRef(realRoot);
          const listed = yield* raw(realRoot, [
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
          ]);
          const branches = listed
            .split("\n")
            .map((name) => name.trim())
            .filter(Boolean);
          return {
            current,
            defaultBranch: defaultRef === null ? null : shortBranchName(defaultRef),
            branches,
          };
        }),

      review: (cwd) =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          const repoRoot = yield* resolveRepoRoot(realRoot);
          const branch = yield* currentBranch(realRoot);
          const { base, baseBranch } = yield* resolveReviewBase(realRoot, branch);
          const files = yield* reviewFiles(realRoot, repoRoot, base);
          return { branch, base, baseBranch, files };
        }),

      diff: (cwd, relativePath) =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
            return yield* new WorkspacePathEscape({ cwd: realRoot, path: relativePath });
          }
          const repoRoot = yield* resolveRepoRoot(realRoot);
          const branch = yield* currentBranch(realRoot);
          const { base } = yield* resolveReviewBase(realRoot, branch);
          const files = yield* reviewFiles(realRoot, repoRoot, base);
          const file = files.find((entry) => entry.path === relativePath);
          if (file === undefined) {
            return yield* new WorkspaceFileNotFound({ path: relativePath });
          }
          const workspaceBlob = file.oldPath ?? file.path;
          const blobPath = toPosixPath(
            path.relative(repoRoot, path.resolve(realRoot, workspaceBlob)),
          );
          const oldContents =
            file.status === "added" ? null : yield* readBlobText(realRoot, base, blobPath);
          const newContents =
            file.status === "deleted" ? null : yield* readWorktreeText(realRoot, file.path);
          return {
            path: file.path,
            status: file.status,
            ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
            oldContents,
            newContents,
            binary: false,
          };
        }),
    };
  }),
);
