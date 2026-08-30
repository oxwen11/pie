import fs from "node:fs";
import sqlite from "node:sqlite";

import { Effect } from "effect";

import { daemonLockDatabasePath, daemonLockPath } from "./paths";

export type DaemonLock = {
  readonly release: Effect.Effect<void>;
};

/**
 * Acquire an OS-backed SQLite write transaction plus a live legacy PID
 * sentinel. Process exit releases the v2 transaction automatically; a crashed
 * composite owner intentionally leaves the legacy sentinel for fail-safe manual
 * recovery, because portable Node APIs cannot atomically remove it by identity.
 */
export const acquireLock = (
  daemonDir: string,
  timeoutMs: number,
): Effect.Effect<DaemonLock, unknown> =>
  Effect.tryPromise({
    try: async (signal) => {
      const database = new sqlite.DatabaseSync(daemonLockDatabasePath(daemonDir), { timeout: 100 });
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

        const releaseLegacy = await acquireLegacySentinel(
          daemonLockPath(daemonDir),
          Math.max(0, deadline - Date.now()),
          signal,
        );
        let released = false;
        return {
          release: Effect.promise(async () => {
            if (released) return;
            released = true;
            await releaseLegacy();
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

async function acquireLegacySentinel(
  lockPath: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const snapshot = String(process.pid);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    try {
      await fs.promises.writeFile(lockPath, snapshot, { flag: "wx", mode: 0o600 });
      return async () => {
        const current = await fs.promises.readFile(lockPath, "utf8").catch(() => undefined);
        if (current === snapshot) await fs.promises.unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await migrateLegacyLock(lockPath, Math.max(0, deadline - Date.now()));
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the legacy daemon lock", { cause: error });
      }
    }
  }
}

/** Wait for or remove the legacy pid-only lock before entering the v2 lock. */
export async function migrateLegacyLock(
  lockPath: string,
  timeoutMs: number,
  afterLstat?: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let info: fs.Stats;
    try {
      info = await fs.promises.lstat(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    // An unshipped development version briefly used a directory here. Never
    // remove it: it may still be an active old owner. Its normal release removes
    // the directory; otherwise fail safely instead of violating exclusion.
    if (info.isDirectory()) {
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the legacy daemon lock directory");
      }
      await delay(100);
      continue;
    }

    await afterLstat?.();
    let raw: string;
    try {
      raw = await fs.promises.readFile(lockPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      raw = "";
    }
    const holder = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(holder) && holder > 0 && processExists(holder)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for legacy daemon lock held by pid ${holder}`);
      }
      await delay(100);
      continue;
    }

    const current = await fs.promises.readFile(lockPath, "utf8").catch(() => undefined);
    if (current === undefined || current !== raw) continue;
    throw new Error(
      `Refusing to automatically remove stale legacy daemon lock ${lockPath}; ` +
        "close older Pie launchers, remove the lock, and retry",
    );
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
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
