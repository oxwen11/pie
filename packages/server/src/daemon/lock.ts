import sqlite from "node:sqlite";

import { Effect } from "effect";

import { daemonLockPath } from "./paths";

export type DaemonLock = {
  readonly release: Effect.Effect<void>;
};

/**
 * Acquire an OS-backed SQLite write transaction. Process exit closes the
 * connection and releases the lock without pathname-based stale-lock recovery.
 */
export const acquireLock = (
  daemonDir: string,
  timeoutMs: number,
): Effect.Effect<DaemonLock, unknown> =>
  Effect.tryPromise({
    try: async (signal) => {
      const database = new sqlite.DatabaseSync(daemonLockPath(daemonDir), { timeout: 100 });
      const deadline = Date.now() + timeoutMs;

      try {
        for (;;) {
          signal.throwIfAborted();
          try {
            database.exec("BEGIN IMMEDIATE");
            break;
          } catch (error) {
            if (Date.now() >= deadline) {
              throw new Error("Timed out waiting for the pie daemon lock", { cause: error });
            }
            await delay(25, signal);
          }
        }

        let released = false;
        return {
          release: Effect.sync(() => {
            if (released) return;
            released = true;
            try {
              database.exec("COMMIT");
            } finally {
              database.close();
            }
          }).pipe(Effect.ignore),
        };
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {}
        database.close();
        throw error;
      }
    },
    catch: (cause) => cause,
  });

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("Lock acquisition aborted"),
        );
      },
      { once: true },
    );
  });
}
