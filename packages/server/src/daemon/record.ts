import {
  type DaemonCompatibilityKey,
  decodeDaemonCompatibilityKey,
} from "@getpie/core/compatibility";
import { writeFileAtomic } from "@getpie/effect-json-store";
import { Effect, FileSystem, type PlatformError } from "effect";

import { daemonRecordPath } from "./paths";

/**
 * The discovery record the launcher writes to `$PIE_DAEMON_DIR/daemon.pid` —
 * the local mirror of the SSH remote's `ssh-launch/<stateKey>/{pid,port,token}`.
 * It is the single-instance marker: staleness is decided by "is the pid alive",
 * never a lock the server holds. The server itself never reads or writes it.
 */
export type DaemonRecord = {
  /** The detached server process's pid. */
  readonly pid: number;
  /** Where the daemon listens, e.g. `http://127.0.0.1:41234`. */
  readonly address: string;
  /** The auth token the daemon was started with; front-doors read it from here. */
  readonly token: string;
  /** Epoch millis the record was written. */
  readonly startedAt: number;
  /** Exact-match compatibility class; absent on legacy or malformed records. */
  readonly compatibilityKey?: DaemonCompatibilityKey;
};

/** Read and validate the record, or `undefined` if missing/garbage. */
export const readRecord = (
  daemonDir: string,
): Effect.Effect<DaemonRecord | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(daemonRecordPath(daemonDir))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (raw === undefined) return undefined;

    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (typeof parsed !== "object" || parsed === null) return undefined;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.pid === "number" &&
      typeof candidate.address === "string" &&
      typeof candidate.token === "string"
    ) {
      const compatibilityKey = decodeDaemonCompatibilityKey(candidate.compatibilityKey);
      return {
        pid: candidate.pid,
        address: candidate.address,
        token: candidate.token,
        startedAt: typeof candidate.startedAt === "number" ? candidate.startedAt : 0,
        ...(compatibilityKey === undefined ? undefined : { compatibilityKey }),
      };
    }
    return undefined;
  });

/**
 * Atomically write the record with `0600` perms (token is a secret). The
 * shared writer renames a sibling temp file over the target so a concurrent
 * reader never sees a half-written file, and removes the temp file when the
 * write fails or is interrupted.
 */
export const writeRecord = (
  daemonDir: string,
  record: DaemonRecord,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) =>
    writeFileAtomic(fs, daemonRecordPath(daemonDir), JSON.stringify(record), { mode: 0o600 }),
  );

/** Remove the record; a missing file is not an error. */
export const removeRecord = (
  daemonDir: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.remove(daemonRecordPath(daemonDir), { force: true })).pipe(
    Effect.ignore,
  );
