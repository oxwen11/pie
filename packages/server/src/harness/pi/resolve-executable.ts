import { Effect, FileSystem } from "effect";

import { findExecutable } from "../executable";

/** How the server spawns `pi --mode rpc`. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

/**
 * Pick the Pi binary for this process. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1`
 * 2. `PIE_PI_EXECUTABLE`
 * 3. bare `pi` on PATH (the user installs Pi themselves)
 */
export function resolvePiExecutable(env: NodeJS.ProcessEnv = process.env): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit) {
    return { command: explicit, prefixArgs: [] };
  }

  return { command: "pi", prefixArgs: [] };
}

/** What `availability` should stat or PATH-search. */
export function piAvailabilityTarget(executable: PiExecutable): string {
  return executable.prefixArgs[0] ?? executable.command;
}

export const checkPiAvailability = (
  executable: PiExecutable,
): Effect.Effect<
  { available: true } | { available: false; reason: string },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    // Bundled Pi is a .js entry run under Node — npm does not mark it +x.
    if (executable.prefixArgs.length > 0) {
      const script = executable.prefixArgs[0]!;
      const fs = yield* FileSystem.FileSystem;
      const info = yield* fs.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: "Bundled Pi is missing." };
    }

    const found = yield* findExecutable(executable.command);
    return found ? { available: true } : { available: false, reason: "Pi was not found on PATH." };
  });
