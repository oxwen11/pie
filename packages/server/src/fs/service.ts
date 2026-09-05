import buffer from "node:buffer";
import path from "node:path";

import { Context, Effect, FileSystem, Layer, Stream, type PlatformError } from "effect";

import {
  WorkspaceBinaryFile,
  WorkspaceFileNotFound,
  WorkspaceFileTooLarge,
  WorkspaceNotDirectory,
  WorkspaceNotFile,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import { contains, detectImageMimeType, hasBinaryMagicPrefix, toPosixPath } from "../path-safety";
import { resolveWorkspaceRoot, workspaceReadError } from "../workspace-root";

/** Largest file we will render as text; larger files are rejected, not truncated. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SCAN_CONCURRENCY = 32;
const NUL_BYTE = 0;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".terraform",
]);

const EXCLUDED_DIRECTORY_SEQUENCES = [
  [".yarn", "unplugged"],
  ["vendor", "bundle"],
] as const;

const isNotFound = (cause: PlatformError.PlatformError): boolean =>
  cause.reason._tag === "NotFound";

const shouldExcludeDirectory = (relativePath: string, name: string): boolean => {
  if (EXCLUDED_DIRECTORY_NAMES.has(name)) return true;
  const segments = relativePath.split("/");
  return EXCLUDED_DIRECTORY_SEQUENCES.some((sequence) => {
    if (segments.length < sequence.length) return false;
    const offset = segments.length - sequence.length;
    return sequence.every((segment, index) => segments[offset + index] === segment);
  });
};

type ReadFileError =
  | WorkspacePathEscape
  | WorkspaceFileNotFound
  | WorkspaceNotFile
  | WorkspaceFileTooLarge
  | WorkspaceBinaryFile
  | WorkspaceReadError;

export type WorkspaceFilePreview =
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "image"; readonly mimeType: string; readonly data: string };

type ReadTreeError = WorkspacePathEscape | WorkspaceNotDirectory | WorkspaceReadError;

export type WorkspaceSymlinkTarget = "file" | "directory" | "broken" | "outside" | "other";

export type WorkspaceTreeEntry =
  | { readonly path: string; readonly type: "directory" | "file" }
  | {
      readonly path: string;
      readonly type: "symlink";
      readonly symlinkTarget: WorkspaceSymlinkTarget;
    };

export interface WorkspaceTreeResult {
  readonly entries: ReadonlyArray<WorkspaceTreeEntry>;
}

interface ScanCandidate {
  readonly absolutePath: string;
  readonly name: string;
  readonly relativePath: string;
}

/**
 * Read-only workspace filesystem module. It hides path confinement, scan
 * exclusions, bounded traversal, symlink classification, size limits, and
 * binary detection behind two operations used by the RPC adapter.
 */
export class FileSystemService extends Context.Service<
  FileSystemService,
  {
    readonly readFileString: (
      cwd: string,
      path: string,
    ) => Effect.Effect<WorkspaceFilePreview, ReadFileError>;
    readonly readTree: (cwd: string) => Effect.Effect<WorkspaceTreeResult, ReadTreeError>;
  }
>()("pie/FileSystemService") {}

export const FileSystemServiceLayer: Layer.Layer<FileSystemService, never, FileSystem.FileSystem> =
  Layer.effect(
    FileSystemService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const readError = workspaceReadError;

      const fileReadError = (relativePath: string) => (cause: PlatformError.PlatformError) =>
        isNotFound(cause)
          ? new WorkspaceFileNotFound({ path: relativePath })
          : new WorkspaceReadError({ path: relativePath, cause });

      const resolveRoot = resolveWorkspaceRoot(fs);

      const resolveFileWithin = (cwd: string, relativePath: string) =>
        Effect.gen(function* () {
          if (!path.isAbsolute(cwd) || path.isAbsolute(relativePath)) {
            return yield* new WorkspacePathEscape({ cwd, path: relativePath });
          }
          const absolutePath = path.resolve(cwd, relativePath);
          if (!contains(cwd, absolutePath)) {
            return yield* new WorkspacePathEscape({ cwd, path: relativePath });
          }
          const realRoot = yield* fs
            .realPath(cwd)
            .pipe(Effect.mapError(fileReadError(relativePath)));
          const realTarget = yield* fs
            .realPath(absolutePath)
            .pipe(Effect.mapError(fileReadError(relativePath)));
          if (!contains(realRoot, realTarget)) {
            return yield* new WorkspacePathEscape({ cwd, path: relativePath });
          }
          return realTarget;
        });

      const classifySymlink = (
        realRoot: string,
        absolutePath: string,
      ): Effect.Effect<WorkspaceSymlinkTarget> =>
        fs.realPath(absolutePath).pipe(
          Effect.flatMap((realTarget) => {
            if (!contains(realRoot, realTarget)) {
              return Effect.succeed<WorkspaceSymlinkTarget>("outside");
            }
            return fs.stat(realTarget).pipe(
              Effect.map((info): WorkspaceSymlinkTarget => {
                if (info.type === "File") return "file";
                if (info.type === "Directory") return "directory";
                return "other";
              }),
              Effect.catch(() => Effect.succeed<WorkspaceSymlinkTarget>("broken")),
            );
          }),
          Effect.catch(() => Effect.succeed<WorkspaceSymlinkTarget>("broken")),
        );

      const readTree = (cwd: string): Effect.Effect<WorkspaceTreeResult, ReadTreeError> =>
        Effect.gen(function* () {
          const realRoot = yield* resolveRoot(cwd);
          const entries: WorkspaceTreeEntry[] = [];
          let pendingDirectories = [""];

          while (pendingDirectories.length > 0) {
            const currentDirectories = pendingDirectories;
            pendingDirectories = [];

            const directoryCandidates = yield* Effect.forEach(
              currentDirectories,
              (relativeDirectory) => {
                const absoluteDirectory = relativeDirectory
                  ? path.join(cwd, relativeDirectory)
                  : cwd;
                const listDirectory = Effect.gen(function* () {
                  const realDirectory = yield* fs.realPath(absoluteDirectory);
                  if (!contains(realRoot, realDirectory)) return [];
                  const names = yield* fs.readDirectory(absoluteDirectory);
                  names.sort((left, right) =>
                    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
                  );
                  return names.map(
                    (name): ScanCandidate => ({
                      absolutePath: path.join(absoluteDirectory, name),
                      name,
                      relativePath: toPosixPath(
                        relativeDirectory ? path.join(relativeDirectory, name) : name,
                      ),
                    }),
                  );
                });

                if (relativeDirectory === "") {
                  return listDirectory.pipe(Effect.mapError(readError(".")));
                }
                // Keep the directory itself visible if one subtree becomes
                // unreadable or disappears during a scan; omit only descendants.
                return listDirectory.pipe(Effect.catch(() => Effect.succeed<ScanCandidate[]>([])));
              },
              { concurrency: SCAN_CONCURRENCY },
            );

            const classified = yield* Effect.forEach(
              directoryCandidates.flat(),
              (candidate) => {
                // Effect FileSystem.stat follows links on Node. Probe readLink
                // first so links remain visible leaves instead of inheriting
                // their target kind and accidentally entering the scan queue.
                const classifyRegularEntry = fs.stat(candidate.absolutePath).pipe(
                  Effect.map((info): WorkspaceTreeEntry | undefined => {
                    // Git worktrees represent metadata as a `.git` file while
                    // regular repositories use a directory. Hide both regular
                    // forms, but retain `.git` symlinks as non-recursive leaves.
                    if (candidate.name === ".git") return undefined;
                    if (info.type === "Directory") {
                      if (shouldExcludeDirectory(candidate.relativePath, candidate.name)) {
                        return undefined;
                      }
                      pendingDirectories.push(candidate.relativePath);
                      return { path: candidate.relativePath, type: "directory" };
                    }
                    if (info.type === "File") {
                      return { path: candidate.relativePath, type: "file" };
                    }
                    return undefined;
                  }),
                  Effect.catch(() => Effect.succeed(undefined)),
                );

                return fs.readLink(candidate.absolutePath).pipe(
                  Effect.flatMap(() =>
                    classifySymlink(realRoot, candidate.absolutePath).pipe(
                      Effect.map(
                        (symlinkTarget): WorkspaceTreeEntry => ({
                          path: candidate.relativePath,
                          type: "symlink",
                          symlinkTarget,
                        }),
                      ),
                    ),
                  ),
                  Effect.catch(() => classifyRegularEntry),
                );
              },
              { concurrency: SCAN_CONCURRENCY },
            );

            entries.push(
              ...classified.filter((entry): entry is WorkspaceTreeEntry => entry !== undefined),
            );
          }

          entries.sort((left, right) =>
            left.path.localeCompare(right.path, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
          return { entries };
        });

      const previewFromBytes = (
        bytes: Uint8Array,
        relativePath: string,
      ): Effect.Effect<WorkspaceFilePreview, WorkspaceBinaryFile> => {
        const mimeType = detectImageMimeType(bytes);
        if (mimeType !== undefined) {
          return Effect.succeed({
            kind: "image",
            mimeType,
            data: buffer.Buffer.from(bytes).toString("base64"),
          });
        }
        if (bytes.includes(NUL_BYTE) || hasBinaryMagicPrefix(bytes)) {
          return Effect.fail(new WorkspaceBinaryFile({ path: relativePath }));
        }
        try {
          return Effect.succeed({
            kind: "text",
            content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          });
        } catch {
          return Effect.fail(new WorkspaceBinaryFile({ path: relativePath }));
        }
      };

      const readFileString = (
        cwd: string,
        relativePath: string,
      ): Effect.Effect<WorkspaceFilePreview, ReadFileError> =>
        Effect.gen(function* () {
          const realTarget = yield* resolveFileWithin(cwd, relativePath);
          const info = yield* fs
            .stat(realTarget)
            .pipe(Effect.mapError(fileReadError(relativePath)));
          if (info.type !== "File") {
            return yield* new WorkspaceNotFile({ path: relativePath });
          }
          const size = Number(info.size);
          if (size > MAX_FILE_BYTES) {
            return yield* new WorkspaceFileTooLarge({
              path: relativePath,
              size,
              limit: MAX_FILE_BYTES,
            });
          }
          const chunks = yield* fs
            .stream(realTarget, { bytesToRead: MAX_FILE_BYTES + 1 })
            .pipe(Stream.runCollect, Effect.mapError(fileReadError(relativePath)));
          const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
          if (byteLength > MAX_FILE_BYTES) {
            return yield* new WorkspaceFileTooLarge({
              path: relativePath,
              size: Math.max(size, byteLength),
              limit: MAX_FILE_BYTES,
            });
          }
          const bytes = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return yield* previewFromBytes(bytes, relativePath);
        });

      return {
        readFileString: Effect.fn("FileSystemService.readFileString")(readFileString),
        readTree: Effect.fn("FileSystemService.readTree")(readTree),
      };
    }),
  );
