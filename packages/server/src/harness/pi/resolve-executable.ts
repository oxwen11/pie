import path from "node:path";
import url from "node:url";

import { Effect, FileSystem, Option } from "effect";

import { pieE2e, pieE2ePiExecutable, piePiExecutable } from "../../config/env";
import { findExecutable } from "../executable";

/** How the server spawns `pi --mode rpc`. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

/**
 * Resolve the npm-shipped Pi CLI when `@earendil-works/pi-coding-agent` is on
 * disk next to the running server (desktop asar or global `pie` install).
 */
export function resolveBundledPiCli(): string | undefined {
  try {
    const indexPath = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return path.join(path.dirname(indexPath), "cli.js");
  } catch {
    return undefined;
  }
}

/**
 * Pick the Pi binary for this process. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1`
 * 2. `PIE_PI_EXECUTABLE`
 * 3. bundled `@earendil-works/pi-coding-agent` via Node (`process.execPath`)
 * 4. bare `pi` on PATH
 */
export function resolvePiExecutable(env: NodeJS.ProcessEnv = process.env): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit) {
    return { command: explicit, prefixArgs: [] };
  }

  const bundled = resolveBundledPiCli();
  if (bundled) {
    return { command: process.execPath, prefixArgs: [bundled] };
  }

  return { command: "pi", prefixArgs: [] };
}

/** Same resolution as {@link resolvePiExecutable}, via Effect Config. */
export const resolvePiExecutableEffect: Effect.Effect<PiExecutable> = Effect.gen(function* () {
  const e2e = yield* pieE2e;
  const e2eExec = yield* pieE2ePiExecutable;
  if (e2e === "1" && Option.isSome(e2eExec)) {
    return { command: e2eExec.value, prefixArgs: [] };
  }

  const explicit = yield* piePiExecutable;
  if (Option.isSome(explicit) && explicit.value.trim().length > 0) {
    return { command: explicit.value.trim(), prefixArgs: [] };
  }

  const bundled = resolveBundledPiCli();
  if (bundled) {
    return { command: process.execPath, prefixArgs: [bundled] };
  }

  return { command: "pi", prefixArgs: [] };
});

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
