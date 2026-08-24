import { Effect } from "effect";

import type { DaemonRecord } from "./record";

const HEALTH_TIMEOUT_MS = 1_000;

export type HealthProbeResult =
  | {
      readonly status: "healthy";
      readonly address: string;
      readonly port: number | undefined;
      readonly probeDurationMs: number;
      readonly httpStatus: number;
    }
  | {
      readonly status: "health_timeout";
      readonly address: string;
      readonly port: number | undefined;
      readonly probeDurationMs: number;
      readonly probeError: string;
    }
  | {
      readonly status: "unhealthy";
      readonly address: string;
      readonly port: number | undefined;
      readonly probeDurationMs: number;
      readonly probeError?: string;
      readonly httpStatus?: number;
    };

export type DaemonLivenessResult =
  | ({
      readonly status: "healthy";
      readonly pid: number;
      readonly consecutiveMisses: 0;
    } & HealthProbeResult)
  | {
      readonly status: "process_missing";
      readonly pid: number;
      readonly address: string;
      readonly port: number | undefined;
      readonly consecutiveMisses: number;
    }
  | ({
      readonly pid: number;
      readonly consecutiveMisses: number;
    } & Exclude<HealthProbeResult, { readonly status: "healthy" }>);

export type DaemonLivenessFailure = Exclude<DaemonLivenessResult, { readonly status: "healthy" }>;

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
 * Probe `${address}/api/health` with enough detail to distinguish a wedged
 * process from a dead one. The caller supplies a signal only in tests; normal
 * probes use the hard one-second bound.
 */
export const probeHealth = (
  address: string,
  signal: AbortSignal = AbortSignal.timeout(HEALTH_TIMEOUT_MS),
): Effect.Effect<HealthProbeResult> =>
  Effect.promise(async () => {
    const started = performance.now();
    const base = () => ({
      address,
      port: portOf(address),
      probeDurationMs: Math.round(performance.now() - started),
    });

    try {
      const response = await fetch(new URL("/api/health", address), { signal });
      if (!response.ok) {
        return {
          status: "unhealthy",
          ...base(),
          httpStatus: response.status,
          probeError: `health endpoint returned HTTP ${response.status}`,
        };
      }
      if ((await response.text()) !== "ok") {
        return {
          status: "unhealthy",
          ...base(),
          httpStatus: response.status,
          probeError: "health endpoint returned an unexpected body",
        };
      }
      return { status: "healthy", ...base(), httpStatus: response.status };
    } catch (error) {
      return {
        status: timedOut(signal, error) ? "health_timeout" : "unhealthy",
        ...base(),
        probeError: describeError(error),
      };
    }
  });

/** Boolean compatibility wrapper used by launcher readiness/status checks. */
export const healthy = (address: string, signal?: AbortSignal): Effect.Effect<boolean> =>
  probeHealth(address, signal).pipe(Effect.map((result) => result.status === "healthy"));

/**
 * Two-signal liveness with diagnostic detail. A healthy result resets misses;
 * every failed process or health probe increments the caller's consecutive
 * miss count so a polling supervisor can report the threshold it acted on.
 */
export const daemonLiveness = (
  record: Pick<DaemonRecord, "pid" | "address">,
  consecutiveMisses = 0,
  signal?: AbortSignal,
): Effect.Effect<DaemonLivenessResult> => {
  const identity = {
    pid: record.pid,
    address: record.address,
    port: portOf(record.address),
  };
  if (!pidAlive(record.pid)) {
    return Effect.succeed({
      status: "process_missing",
      ...identity,
      consecutiveMisses: consecutiveMisses + 1,
    });
  }
  return probeHealth(record.address, signal).pipe(
    Effect.map(
      (result): DaemonLivenessResult =>
        result.status === "healthy"
          ? { ...result, pid: record.pid, consecutiveMisses: 0 }
          : { ...result, pid: record.pid, consecutiveMisses: consecutiveMisses + 1 },
    ),
  );
};

/** True only when both the recorded process and health endpoint are alive. */
export const daemonAlive = (record: DaemonRecord): Effect.Effect<boolean> =>
  daemonLiveness(record).pipe(Effect.map((result) => result.status === "healthy"));

function portOf(address: string): number | undefined {
  try {
    const port = Number(new URL(address).port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

function timedOut(signal: AbortSignal, error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  return (
    signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
  );
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
    return `${error.name}: ${error.message} (${cause.code})`;
  }
  return `${error.name}: ${error.message}`;
}
