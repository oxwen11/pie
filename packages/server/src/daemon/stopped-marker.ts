import { Clock, Effect, FileSystem, type PlatformError } from "effect";

import { daemonStoppedMarkerPath } from "./paths";

/**
 * Whether `$PIE_HOME/daemon/daemon.stopped` is present. An explicit
 * `stopDaemon` writes it so automatic supervision (the desktop respawn loop)
 * does not start a daemon the user deliberately stopped. An explicit start
 * deletes it. The file's existence is the signal; the timestamp is only for
 * debugging.
 */
export const hasStoppedMarker = (
  daemonDir: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.exists(daemonStoppedMarkerPath(daemonDir))).pipe(
    Effect.orElseSucceed(() => false),
  );

export const writeStoppedMarker = (
  daemonDir: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const now = yield* Clock.currentTimeMillis;
    yield* fs.makeDirectory(daemonDir, { recursive: true });
    yield* fs.writeFileString(daemonStoppedMarkerPath(daemonDir), String(now), { mode: 0o600 });
  });

export const clearStoppedMarker = (
  daemonDir: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) =>
    fs.remove(daemonStoppedMarkerPath(daemonDir), { force: true }),
  ).pipe(Effect.ignore);
