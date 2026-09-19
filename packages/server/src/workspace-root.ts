import path from "node:path";

import { Effect, type FileSystem } from "effect";

import { WorkspaceNotDirectory, WorkspacePathEscape, WorkspaceReadError } from "./errors";

export const workspaceReadError = (relativePath: string) => (cause: unknown) =>
  new WorkspaceReadError({ path: relativePath, cause });

/**
 * Resolve a workspace cwd to its real, absolute directory path. Rejects
 * relative input, follows symlinks once, and fails when the target is not a
 * directory — the shared front door for every service that confines paths.
 */
export const resolveWorkspaceRoot = (fs: FileSystem.FileSystem) => (cwd: string) =>
  Effect.gen(function* () {
    if (!path.isAbsolute(cwd)) {
      return yield* new WorkspacePathEscape({ cwd, path: "." });
    }
    const realRoot = yield* fs.realPath(cwd).pipe(Effect.mapError(workspaceReadError(".")));
    const info = yield* fs.stat(realRoot).pipe(Effect.mapError(workspaceReadError(".")));
    if (info.type !== "Directory") {
      return yield* new WorkspaceNotDirectory({ path: "." });
    }
    return realRoot;
  });
