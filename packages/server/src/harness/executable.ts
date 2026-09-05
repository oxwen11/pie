import path from "node:path";

import { Effect, FileSystem } from "effect";

/**
 * Locating a CLI executable on PATH before spawning it. Pi resolves its own
 * binary via `resolvePiExecutable`; this helper is shared for cheap
 * availability checks — a PATH lookup answers "can we spawn this command"
 * without starting a process that was never going to succeed.
 *
 * It searches PATH and nothing else, deliberately. Transports spawn the bare
 * command name, which the OS resolves through PATH alone — so any directory
 * this looked in beyond PATH would report available and then fail at spawn with
 * ENOENT. Whatever fixes PATH for the spawn (the desktop's login-shell
 * environment) fixes it for both.
 */

/**
 * Windows resolves a bare name through PATHEXT, and npm-installed CLIs land as
 * `.cmd` shims rather than `.exe` — checking only `.exe` would report every one
 * of them missing.
 */
const WINDOWS_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"];

/** PATH's separator — `node:path.delimiter` is fixed to the host platform. */
export const pathDelimiter = (platform: NodeJS.Platform) => (platform === "win32" ? ";" : ":");

export type FindExecutableDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

/**
 * Is this path a runnable file? `effect/FileSystem.access` has no `X_OK`, so
 * executability is read off the mode bits instead of asked of the kernel: this
 * accepts a binary only the owner may run, where `access(X_OK)` would have
 * rejected it for everyone else. The consequence is an EACCES at spawn time
 * rather than an up-front "not found" — rare for a CLI installed on PATH.
 * Windows has no execute bit at all, so there existence is the whole test —
 * which is also all `access(X_OK)` ever checked there.
 */
export const isExecutableFile = (
  fs: FileSystem.FileSystem,
  candidate: string,
  platform: NodeJS.Platform,
): Effect.Effect<boolean> =>
  fs.stat(candidate).pipe(
    Effect.map(
      (info) => info.type === "File" && (platform === "win32" || (info.mode & 0o111) !== 0),
    ),
    // A candidate that cannot be stat'd (absent, unreadable dir) is not here.
    Effect.orElseSucceed(() => false),
  );

/**
 * The path a bare command name resolves to, or `undefined` when it is not
 * installed. An absolute `command` is taken as an explicit override and only
 * checked for executability.
 */
export const findExecutable = (
  command: string,
  deps: FindExecutableDeps = {},
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const { env = process.env, platform = process.platform } = deps;
    const fs = yield* FileSystem.FileSystem;
    const isExecutable = (candidate: string) => isExecutableFile(fs, candidate, platform);

    if (path.isAbsolute(command)) {
      return (yield* isExecutable(command)) ? command : undefined;
    }

    const names =
      platform !== "win32" || path.extname(command)
        ? [command]
        : WINDOWS_EXTENSIONS.map((extension) => `${command}${extension}`);

    // First hit wins, and PATH order is the answer — so this walks candidates
    // sequentially and stops, rather than stat'ing the whole search space.
    for (const dir of (env["PATH"] ?? "").split(pathDelimiter(platform))) {
      if (!dir) continue;
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (yield* isExecutable(candidate)) return candidate;
      }
    }
    return undefined;
  });
