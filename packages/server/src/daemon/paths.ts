import path from "node:path";

/**
 * The three lifecycle files, named relative to a daemon directory the caller
 * already resolved. Deliberately no default of its own — see
 * `resolveDaemonLocation` in `config/paths.ts`.
 *
 * All three are *state*, not output. The daemon's stdout/stderr used to be a
 * fourth file here; it now sits with the process log under
 * `$PIE_HOME/logs`, so there is one place to look when something needs
 * investigating.
 */

/** Discovery record — pid, address, and the daemon's auth token. */
export const daemonRecordPath = (daemonDir: string): string => path.join(daemonDir, "daemon.pid");

/** Exclusive-create launch lock, held only while a launcher is spawning. */
export const daemonLockPath = (daemonDir: string): string => path.join(daemonDir, "daemon.lock");

/** SQLite-backed v2 lock; separate from the legacy pid-only lock pathname. */
export const daemonLockDatabasePath = (daemonDir: string): string =>
  path.join(daemonDir, "daemon.lock.v2");

/** Written by an explicit stop so supervision does not resurrect the daemon. */
export const daemonTombstonePath = (daemonDir: string): string =>
  path.join(daemonDir, "daemon.stopped");
