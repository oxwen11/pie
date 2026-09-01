import path from "node:path";

import { Effect, FileSystem } from "effect";

import { findExecutable } from "../executable";

/** How the server spawns the pie-owned Pi process. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

const here = import.meta.dirname;

/**
 * Built `pi-process.mjs` only. Sibling of this module when we are already in
 * `dist/` (bundled `server.mjs` / `cli.mjs`); otherwise the server package
 * dist — never the TypeScript source, never a PATH `pi`.
 */
export function resolvePiProcessEntry(): string {
  if (path.basename(here) === "dist") {
    return path.join(here, "pi-process.mjs");
  }
  return path.resolve(here, "../../../dist/pi-process.mjs");
}

/**
 * Pick the Pi process for this server. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1` (unit-test fake scripts)
 * 2. `PIE_PI_EXECUTABLE`
 * 3. pie-owned `pi-process` via Node (`process.execPath`)
 */
export function resolvePiExecutable(env: NodeJS.ProcessEnv = process.env): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit) {
    return { command: explicit, prefixArgs: [] };
  }

  return { command: process.execPath, prefixArgs: [resolvePiProcessEntry()] };
}

/** What `availability` should stat or PATH-search. */
export function piAvailabilityTarget(executable: PiExecutable): string {
  return executable.prefixArgs.at(-1) ?? executable.command;
}

export const checkPiAvailability = (
  executable: PiExecutable,
): Effect.Effect<
  { available: true } | { available: false; reason: string },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    // Node-run scripts (`pi-process.mjs`) are not marked +x.
    if (executable.prefixArgs.length > 0) {
      const script = executable.prefixArgs.at(-1)!;
      const fsService = yield* FileSystem.FileSystem;
      const info = yield* fsService.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: "Pie Pi process is missing." };
    }

    const found = yield* findExecutable(executable.command);
    return found ? { available: true } : { available: false, reason: "Pi was not found on PATH." };
  });
