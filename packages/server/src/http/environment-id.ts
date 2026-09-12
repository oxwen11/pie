import crypto from "node:crypto";
import path from "node:path";

import { Effect, FileSystem } from "effect";

/** Stable daemon identity under `$PIE_HOME/storage/`. Same home, same Environment. */
export function environmentIdFile(home: string): string {
  return path.join(home, "storage", "environment-id");
}

export const loadOrCreateEnvironmentId = (
  home: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = environmentIdFile(home);
    const existing = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = existing.trim();
    if (trimmed.length > 0) return trimmed;

    const id = crypto.randomUUID();
    yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.ignore);
    yield* fs.writeFileString(file, `${id}\n`).pipe(Effect.ignore);
    yield* fs.chmod(file, 0o600).pipe(Effect.ignore);
    return id;
  });
