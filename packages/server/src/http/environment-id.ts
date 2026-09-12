import path from "node:path";

import { Crypto, Effect, FileSystem } from "effect";

import { StoreReadError, StoreWriteError } from "../errors";

/** Stable daemon identity under `$PIE_HOME/storage/`. Same home, same Environment. */
export function environmentIdFile(home: string): string {
  return path.join(home, "storage", "environment-id");
}

const isNotFound = (cause: { readonly reason: { readonly _tag: string } }): boolean =>
  cause.reason._tag === "NotFound";

export const loadOrCreateEnvironmentId = (
  home: string,
): Effect.Effect<string, StoreReadError | StoreWriteError, FileSystem.FileSystem | Crypto.Crypto> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const file = environmentIdFile(home);
    const existing = yield* fs
      .readFileString(file)
      .pipe(
        Effect.catch((cause) =>
          isNotFound(cause) ? Effect.succeed("") : Effect.fail(new StoreReadError({ file, cause })),
        ),
      );
    const trimmed = existing.trim();
    if (trimmed.length > 0) return trimmed;

    const id = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) => new StoreWriteError({ file, cause })),
    );
    yield* fs
      .makeDirectory(path.dirname(file), { recursive: true })
      .pipe(Effect.mapError((cause) => new StoreWriteError({ file, cause })));
    yield* fs
      .writeFileString(file, `${id}\n`)
      .pipe(Effect.mapError((cause) => new StoreWriteError({ file, cause })));
    yield* fs
      .chmod(file, 0o600)
      .pipe(Effect.mapError((cause) => new StoreWriteError({ file, cause })));
    return id;
  });
