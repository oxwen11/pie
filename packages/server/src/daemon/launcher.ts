import childProcess from "node:child_process";
import fs from "node:fs";

import type { DaemonCompatibilityKey } from "@getpie/core/compatibility";
import { Clock, Crypto, Effect, Encoding, FileSystem, type PlatformError } from "effect";

import {
  daemonStdioLogPath,
  LOG_FILE_MODE,
  LOGS_DIRECTORY_MODE,
  logsDirectory,
} from "../config/paths";
import { DaemonLaunchError, DaemonStoppedError } from "./errors";
import { daemonAlive, healthy, pidAlive } from "./liveness";
import { acquireLock } from "./lock";
import { reservePort } from "./port";
import { type DaemonRecord, readRecord, removeRecord, writeRecord } from "./record";
import { clearTombstone, hasTombstone, writeTombstone } from "./tombstone";

const DEFAULT_PORT = 4000;
const READY_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 150;
const STOP_GRACE_MS = 5_000;

export type DaemonHandle = {
  readonly address: string;
  readonly port: number;
  readonly token: string;
  readonly pid: number;
  /** True when an already-running daemon was attached to instead of spawned. */
  readonly reused: boolean;
};

export type ResolveDaemonOptions = {
  /**
   * `$PIE_HOME` — persistent Project and Session data. Only passed on to the
   * spawned daemon; no lifecycle file is derived from it.
   */
  readonly home: string;
  /**
   * `$PIE_DAEMON_DIR` — where the four lifecycle files live and what the
   * single-instance invariant is keyed on. Required; front doors get it from
   * `resolveDaemonLocation` (`config/paths.ts`), which explains why there is no
   * default here.
   */
  readonly daemonDir: string;
  /** Exact compatibility class the running daemon must match to be reused. */
  readonly requiredCompatibilityKey: DaemonCompatibilityKey;
  /**
   * argv that launches the plain foreground server, e.g.
   * `[process.execPath, ...process.execArgv, cliEntry, "serve"]`. The daemon is
   * just this command spawned detached — the server stays daemon-unaware.
   */
  readonly serverArgv: readonly string[];
  /** Preferred port; falls back to an ephemeral one if taken. Default `4000`. */
  readonly port?: number;
  /**
   * Base environment for the spawned daemon (default `process.env`). The
   * desktop passes its resolved login-shell environment plus
   * `ELECTRON_RUN_AS_NODE`; the launcher's own `PIE_*` entries win.
   */
  readonly environment?: NodeJS.ProcessEnv;
  /**
   * Set by automatic supervision loops (the desktop's exit-triggered respawn).
   * While the `daemon.stopped` tombstone is present, an autoRespawn caller
   * fails with `DaemonStoppedError` instead of resurrecting a daemon the user
   * explicitly stopped. Explicit front-doors leave this unset.
   */
  readonly autoRespawn?: boolean;
  readonly readyTimeoutMs?: number;
};

export type DaemonLauncherError = DaemonLaunchError | DaemonStoppedError;

/**
 * The platform services the launcher's file state runs on. Provided at each
 * front door's composition root (CLI `NodeServices`, desktop runtime).
 */
export type DaemonPlatform = FileSystem.FileSystem | Crypto.Crypto;

/**
 * The shared launcher (the local twin of the SSH launch script): read
 * `daemon/daemon.pid`; attach only when a healthy daemon has the required exact
 * compatibility key, otherwise replace it with the foreground server detached,
 * record it, and wait for health. Both the CLI and Desktop go through here so
 * there is exactly one daemon per daemon directory — concurrent launches and
 * replacements are serialized by an OS-backed SQLite transaction at `daemon.lock`.
 *
 * Effect-based orchestration around one deliberately-raw seam: the detached
 * spawn itself (see `spawnDetached`) — everything that sleeps, times out, or
 * can fail lives in Effect so callers get interruption and typed errors.
 *
 * There is no origin negotiation here: the daemon's CORS policy is static (the
 * desktop scheme + loopback are always trusted), so compatibility is the only
 * reuse partition and CORS never triggers a restart-to-widen policy.
 */
export const resolveOrSpawnDaemon = (
  options: ResolveDaemonOptions,
): Effect.Effect<DaemonHandle, DaemonLauncherError, DaemonPlatform> =>
  Effect.gen(function* () {
    if (options.autoRespawn === true && (yield* hasTombstone(options.daemonDir))) {
      return yield* daemonStopped();
    }

    return yield* spawnLocked(options);
  });

/** Read the current daemon's status without starting one. */
export const statusDaemon = (
  daemonDir: string,
): Effect.Effect<
  { readonly running: false } | { readonly running: true; readonly record: DaemonRecord },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const record = yield* readRecord(daemonDir);
    return record === undefined || !(yield* daemonAlive(record))
      ? { running: false }
      : { running: true, record };
  });

/**
 * Stop the daemon and leave a `daemon.stopped` tombstone so automatic
 * supervision (the desktop's respawn loop) does not resurrect it. The
 * tombstone is written before the kill so a respawn racing the stop still
 * sees it. Returns whether anything was running.
 */
export const stopDaemon = (
  daemonDir: string,
): Effect.Effect<
  "stopped" | "not-running",
  DaemonLaunchError | PlatformError.PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    yield* ensureDaemonDirectory(daemonDir);
    const lock = yield* acquireDaemonLock(daemonDir, READY_TIMEOUT_MS);
    return yield* Effect.gen(function* () {
      const record = yield* readRecord(daemonDir);
      if (record === undefined || !pidAlive(record.pid)) {
        yield* removeRecord(daemonDir);
        return "not-running" as const;
      }

      yield* writeTombstone(daemonDir);
      if (!(yield* terminateRecordedDaemon(record))) {
        return yield* Effect.fail(
          new DaemonLaunchError({
            message: `Refusing to forget daemon pid ${record.pid}: ownership or shutdown could not be confirmed`,
          }),
        );
      }
      yield* removeRecord(daemonDir);
      return "stopped" as const;
    }).pipe(Effect.ensuring(lock.release));
  });

/** SIGTERM, wait up to the grace period, escalate to SIGKILL. */
const killPid = (pid: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!pidAlive(pid)) return;
    signal(pid, "SIGTERM");
    const deadline = (yield* Clock.currentTimeMillis) + STOP_GRACE_MS;
    while ((yield* Clock.currentTimeMillis) < deadline && pidAlive(pid)) {
      yield* Effect.sleep(100);
    }
    if (pidAlive(pid)) signal(pid, "SIGKILL");
  });

/**
 * Prove the record token belongs to the server at its address before signaling
 * the recorded pid. New daemons accept authenticated shutdown directly; an
 * older daemon is identified through its authenticated ws-ticket endpoint.
 */
const terminateRecordedDaemon = (record: DaemonRecord): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (!pidAlive(record.pid)) return true;
    if (yield* authenticatedPost(record, "/api/shutdown")) {
      return yield* waitForRecordedDaemonExit(record);
    }
    if (!(yield* authenticatedPost(record, "/api/ws-ticket"))) return false;

    // The legacy endpoint authenticated this record immediately before the one
    // safe signal. Never escalate later using only a reusable numeric pid.
    signal(record.pid, "SIGTERM");
    return yield* waitForRecordedDaemonExit(record);
  });

const waitForRecordedDaemonExit = (record: DaemonRecord): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + STOP_GRACE_MS;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      if (!pidAlive(record.pid)) return true;
      yield* Effect.sleep(100);
    }
    return !pidAlive(record.pid);
  });

const authenticatedPost = (record: DaemonRecord, pathname: string): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    try {
      const response = await fetch(new URL(pathname, record.address), {
        method: "POST",
        headers: { authorization: `Bearer ${record.token}` },
        signal: AbortSignal.timeout(1_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  });

/** Serialize every attach, replacement, spawn, and stop decision. */
const spawnLocked = (
  options: ResolveDaemonOptions,
): Effect.Effect<DaemonHandle, DaemonLauncherError, DaemonPlatform> =>
  Effect.gen(function* () {
    yield* ensureDaemonDirectory(options.daemonDir);
    const lock = yield* acquireDaemonLock(
      options.daemonDir,
      options.readyTimeoutMs ?? READY_TIMEOUT_MS,
    );
    return yield* resolveLocked(options).pipe(Effect.ensuring(lock.release));
  });

/**
 * Re-read and decide while holding the launch lock. Compatibility replacement
 * must be one lock-owned transaction so concurrent new clients cannot kill the
 * replacement daemon selected by the first winner.
 */
const resolveLocked = (
  options: ResolveDaemonOptions,
): Effect.Effect<DaemonHandle, DaemonLauncherError, DaemonPlatform> =>
  Effect.gen(function* () {
    if (options.autoRespawn === true && (yield* hasTombstone(options.daemonDir))) {
      return yield* daemonStopped();
    }
    yield* clearTombstone(options.daemonDir);

    const existing = yield* readRecord(options.daemonDir);
    const existingHealthy = existing !== undefined && (yield* daemonAlive(existing));
    if (existing !== undefined && existing.compatibilityKey === options.requiredCompatibilityKey) {
      if (existingHealthy) return attach(existing, true);

      const timeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
      const now = yield* Clock.currentTimeMillis;
      const remainingMs = Math.max(0, existing.startedAt + timeoutMs - now);
      if (
        remainingMs > 0 &&
        pidAlive(existing.pid) &&
        (yield* waitHealthy(existing.address, existing.pid, remainingMs))
      ) {
        return attach(existing, true);
      }
    } else if (existing !== undefined && existingHealthy) {
      yield* Effect.logInfo("Replacing incompatible pie daemon").pipe(
        Effect.annotateLogs({
          event: "daemon.compatibility_mismatch",
          actualCompatibilityKey: existing.compatibilityKey ?? "legacy",
          requiredCompatibilityKey: options.requiredCompatibilityKey,
          action: "replace",
        }),
      );
    }

    if (existing !== undefined) {
      // Once this launcher owns the lock, no other attach, stop, or replacement
      // decision can race this record generation.
      if (!(yield* terminateRecordedDaemon(existing))) {
        return yield* Effect.fail(
          new DaemonLaunchError({
            message: `Refusing to replace daemon pid ${existing.pid}: ownership or shutdown could not be confirmed`,
          }),
        );
      }
      yield* removeRecord(options.daemonDir);
    }

    return yield* spawnDaemon(options);
  });

const daemonStopped = (): Effect.Effect<never, DaemonStoppedError> =>
  Effect.fail(
    new DaemonStoppedError({
      message:
        "pie daemon was stopped explicitly; not auto-respawning (run `pie daemon start` to start it again)",
    }),
  );

const ensureDaemonDirectory = (
  daemonDir: string,
): Effect.Effect<void, DaemonLaunchError, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.makeDirectory(daemonDir, { recursive: true }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DaemonLaunchError({
          message: `Unable to create ${daemonDir}: ${cause.message}`,
          cause,
        }),
    ),
  );

const acquireDaemonLock = (daemonDir: string, timeoutMs: number) =>
  acquireLock(daemonDir, timeoutMs).pipe(
    Effect.mapError(
      (cause) =>
        new DaemonLaunchError({
          message: `Unable to acquire the pie daemon launch lock: ${String(cause)}`,
          cause,
        }),
    ),
  );

const spawnDaemon = (
  options: ResolveDaemonOptions,
): Effect.Effect<DaemonHandle, DaemonLaunchError, DaemonPlatform> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const port = yield* reservePort(options.port ?? DEFAULT_PORT);
    const token = yield* crypto.randomBytes(32).pipe(
      Effect.map(Encoding.encodeHex),
      Effect.mapError(
        (cause) => new DaemonLaunchError({ message: "Unable to generate a daemon token", cause }),
      ),
    );
    const address = `http://127.0.0.1:${port}`;

    const pid = yield* Effect.try({
      try: () => spawnDetached(options, port, token),
      catch: (cause) =>
        new DaemonLaunchError({
          message: `Unable to spawn the pie daemon: ${String(cause)}`,
          cause,
        }),
    });

    // Record the daemon before waiting for health, not after: a launcher that
    // dies mid-wait (the app quitting seconds after first launch) must not
    // orphan an unrecorded daemon — unrecorded means undiscoverable, so
    // nothing can ever attach to it or stop it, and the next launch spawns a
    // second daemon beside it. A successor that recovers the launch lock polls
    // a live, same-key record for the remainder of this readiness window.
    const record: DaemonRecord = {
      pid,
      address,
      token,
      startedAt: yield* Clock.currentTimeMillis,
      compatibilityKey: options.requiredCompatibilityKey,
    };
    yield* writeRecord(options.daemonDir, record).pipe(
      Effect.mapError(
        (cause) =>
          new DaemonLaunchError({
            message: `Unable to record the pie daemon: ${cause.message}`,
            cause,
          }),
      ),
      Effect.tapError(() => Effect.andThen(killPid(pid), removeRecord(options.daemonDir))),
    );

    const timeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    if (!(yield* waitHealthy(address, pid, timeoutMs))) {
      yield* killPid(pid);
      yield* removeRecord(options.daemonDir);
      return yield* Effect.fail(
        new DaemonLaunchError({
          message: `pie daemon did not become healthy within ${timeoutMs}ms; see ${logsDirectory(options.home)}`,
        }),
      );
    }
    return attach(record, false);
  });

/**
 * The daemon's stdio needs a real file descriptor before the child exists, so
 * this is plain synchronous `node:fs` inside the already-exempt spawn seam.
 *
 * Truncated rather than rotated once it passes the cap. Rotation earns its keep
 * for a log you read; this one holds only what never reached a logger (see
 * `daemon-stdio.log`) and is normally a couple of lines, so an unbounded file
 * would be a disk leak with nothing of value in it.
 */
const STDIO_LOG_MAX_BYTES = 1_000_000;

function openStdioLog(home: string): number {
  const logsDir = logsDirectory(home);
  // Same modes and directory as `Paths.logsDir`. This process is the launcher,
  // not the daemon — the child does not exist yet, so the observability Layer
  // cannot have created `logs/`. Whichever path creates the directory first
  // wins the mode; both must spell the same numbers.
  fs.mkdirSync(logsDir, { recursive: true, mode: LOGS_DIRECTORY_MODE });
  const file = daemonStdioLogPath(logsDir);
  try {
    if (fs.statSync(file).size > STDIO_LOG_MAX_BYTES) fs.truncateSync(file, 0);
  } catch {
    // No file yet, or it cannot be stat'd — `openSync` below decides.
  }
  return fs.openSync(file, "a", LOG_FILE_MODE);
}

/**
 * The one seam Effect cannot model: a detached, unref'd child with stdio
 * redirected to a log fd — the exact opposite of a supervised
 * `ChildProcessSpawner` child (piped stdio, killed when its scope closes).
 * The daemon must outlive this launcher, so this stays raw `node:child_process`
 * — the local `nohup pie serve > log`.
 */
function spawnDetached(options: ResolveDaemonOptions, port: number, token: string): number {
  const { home, daemonDir } = options;
  const logFd = openStdioLog(home);
  try {
    const [command, ...args] = options.serverArgv;
    if (command === undefined) throw new Error("serverArgv must not be empty");

    const inherited = options.environment ?? process.env;

    const child = childProcess.spawn(command, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        // Extra CORS origins (if any) ride the inherited environment's
        // PIE_CORS_ORIGINS — the launcher no longer computes a per-launch
        // set, since the daemon's policy is otherwise static.
        ...inherited,
        PIE_HOME: home,
        PIE_DAEMON_DIR: daemonDir,
        PIE_PORT: String(port),
        PIE_AUTH_TOKEN: token,
      },
    });
    child.unref();

    if (child.pid === undefined) throw new Error("Failed to spawn pie daemon (no pid)");
    return child.pid;
  } finally {
    fs.closeSync(logFd);
  }
}

/**
 * Two-signal readiness: the process must still be alive (a crash during boot
 * short-circuits the wait) and answer `/api/health`.
 */
const waitHealthy = (address: string, pid: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      if (!pidAlive(pid)) return false;
      if (yield* healthy(address)) return true;
      yield* Effect.sleep(HEALTH_POLL_INTERVAL_MS);
    }
    return false;
  });

function attach(record: DaemonRecord, reused: boolean): DaemonHandle {
  return {
    address: record.address,
    port: Number(new URL(record.address).port),
    token: record.token,
    pid: record.pid,
    reused,
  };
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
}
