import { Effect } from "effect";

import type { DaemonRecord } from "./record";

const HEALTH_TIMEOUT_MS = 1_000;

/** True if a process with this pid exists (signal 0 probes without killing). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we may not signal it — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True if `${address}/api/health` answers `ok`. Always bounded: a wedged
 * daemon that accepts connections but never responds must read as unhealthy,
 * not hang the probe (and with it every liveness poll built on top).
 */
export const healthy = (address: string, signal?: AbortSignal): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    try {
      const res = await fetch(new URL("/api/health", address), {
        signal: signal ?? AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return res.ok && (await res.text()) === "ok";
    } catch {
      return false;
    }
  });

/**
 * Coarse liveness: the recorded pid exists and the recorded address answers
 * health. This does not establish process ownership; destructive operations
 * separately authenticate the record token against the address first.
 */
export const daemonAlive = (record: DaemonRecord): Effect.Effect<boolean> =>
  pidAlive(record.pid) ? healthy(record.address) : Effect.succeed(false);
