import { Effect, FileSystem } from "effect";

import { findExecutable } from "../executable";

/** How the server spawns `pi --mode rpc`. */
export type PiExecutable = {
  readonly command: string;
};

/**
 * Pick the Pi binary for this process. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1`
 * 2. `PIE_PI_EXECUTABLE`
 * 3. bare `pi` on PATH (the user installs Pi themselves)
 */
export function resolvePiExecutable(env: NodeJS.ProcessEnv = process.env): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE };
  }

  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit) {
    return { command: explicit };
  }

  return { command: "pi" };
}

export const checkPiAvailability = (
  executable: PiExecutable,
): Effect.Effect<
  { available: true } | { available: false; reason: string },
  never,
  FileSystem.FileSystem
> =>
  Effect.map(findExecutable(executable.command), (found) =>
    found ? { available: true } : { available: false, reason: "Pi was not found on PATH." },
  );
