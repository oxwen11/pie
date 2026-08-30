import { Effect } from "effect";

import { parseProtocolVersion, PIE_PROTOCOL_HEADER } from "../http/protocol";
import type { DaemonRecord } from "./record";

const HEALTH_TIMEOUT_MS = 1_000;

export type DaemonHealth = {
  readonly healthy: boolean;
  readonly protocolVersion?: number;
};

/** True if a process with this pid exists (signal 0 probes without killing). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Probe health and read the optional protocol capability header. */
export const probeHealth = (address: string, signal?: AbortSignal): Effect.Effect<DaemonHealth> =>
  Effect.promise(async () => {
    try {
      const response = await fetch(new URL("/api/health", address), {
        signal: signal ?? AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const body = await response.text();
      if (!response.ok || body !== "ok") return { healthy: false };
      const protocolVersion = parseProtocolVersion(response.headers.get(PIE_PROTOCOL_HEADER));
      return protocolVersion === undefined ? { healthy: true } : { healthy: true, protocolVersion };
    } catch {
      return { healthy: false };
    }
  });

/** True if `${address}/api/health` answers `ok`. */
export const healthy = (address: string, signal?: AbortSignal): Effect.Effect<boolean> =>
  probeHealth(address, signal).pipe(Effect.map((result) => result.healthy));

/**
 * Coarse liveness: the recorded pid exists and the recorded address answers
 * health. This does not establish process ownership; destructive operations
 * separately authenticate the record token against the address first.
 */
export const daemonAlive = (record: DaemonRecord): Effect.Effect<boolean> =>
  pidAlive(record.pid) ? healthy(record.address) : Effect.succeed(false);
