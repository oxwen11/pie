import { createCloseablePieClient, getWsTicket, type CloseablePieClient } from "@getpie/client";
import {
  DaemonLaunchError,
  type DaemonLauncherError,
  type DaemonPlatform,
  type DaemonRecord,
  resolveDaemonDirectory,
  statusDaemon,
} from "@getpie/server/daemon";
import { resolveServeConfig } from "@getpie/server/http";
import { type Config, Effect, Option } from "effect";
import { Flag } from "effect/unstable/cli";

import { resolveCliDaemon } from "./daemon";

export type PieEndpoint = {
  readonly address: string;
  readonly token: string | undefined;
};

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value;

/** Origin-only address so `/ws/rpc` and `/api/ws-ticket` join cleanly. */
export const normalizeAddress = (raw: string): string => new URL(raw).origin;

export const urlFlag = () =>
  Flag.string("url").pipe(
    Flag.withDescription(
      "Pie server URL (also PIE_URL). Connects only — never starts a daemon. Token from PIE_AUTH_TOKEN, or the local daemon record when the URL matches.",
    ),
    Flag.optional,
  );

export const CONNECT_HINT =
  "Pass PIE_AUTH_TOKEN for that server, or omit --url / PIE_URL to attach to the local daemon (`pie daemon start`, `pie status`).";

const START_HINT = "Start it with: pie daemon start\nCheck it with: pie status";

/**
 * Explicit `--url` / `PIE_URL`: never spawn. Prefer `PIE_AUTH_TOKEN`, then the
 * live local daemon's token when the origins match (CLI attaching to the
 * desktop's daemon by address). Unauthenticated `pie serve` stays tokenless.
 */
export const endpointFromExplicitUrl = (
  raw: string,
  authToken: string | undefined,
  record: Pick<DaemonRecord, "address" | "token"> | undefined,
): PieEndpoint => {
  const address = normalizeAddress(raw);
  const envToken = emptyToUndefined(authToken);
  if (envToken !== undefined) return { address, token: envToken };
  if (record !== undefined && normalizeAddress(record.address) === address) {
    return { address, token: record.token };
  }
  return { address, token: undefined };
};

export const describeConnectFailure = (error: unknown, endpoint: PieEndpoint): Error => {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b/.test(message) || /unauthorized/i.test(message)) {
    return new Error(`${message}\n${CONNECT_HINT}`);
  }
  if (endpoint.token === undefined && /ticket/i.test(message)) {
    return new Error(`${message}\n${CONNECT_HINT}`);
  }
  return error instanceof Error ? error : new Error(message);
};

const withLaunchHint = (error: DaemonLauncherError): DaemonLauncherError => {
  if (error.message.includes("pie daemon start")) return error;
  if (error._tag === "DaemonStoppedError") return error;
  return new DaemonLaunchError({
    message: `${error.message}\n${START_HINT}`,
    cause: error.cause,
  });
};

/**
 * Discover the pie server this CLI should talk to.
 *
 * 1. `--url` / `PIE_URL` — connect only, never spawn.
 * 2. Otherwise attach to the local daemon, spawning one if needed.
 */
export const resolvePieEndpoint = (
  url: Option.Option<string>,
): Effect.Effect<PieEndpoint, DaemonLauncherError | Config.ConfigError, DaemonPlatform> =>
  Effect.gen(function* () {
    const explicit = Option.getOrUndefined(url) ?? emptyToUndefined(process.env.PIE_URL);
    const status = yield* statusDaemon(resolveDaemonDirectory());
    const record = status.running ? status.record : undefined;

    if (explicit !== undefined) {
      return yield* Effect.try({
        try: () => endpointFromExplicitUrl(explicit, process.env.PIE_AUTH_TOKEN, record),
        catch: (cause) =>
          new DaemonLaunchError({
            message: cause instanceof Error ? `${cause.message}\n${CONNECT_HINT}` : CONNECT_HINT,
            cause,
          }),
      });
    }

    const { port } = yield* resolveServeConfig({
      port: Option.none(),
      corsOrigin: [],
      allowedHost: [],
    });
    const handle = yield* resolveCliDaemon(port).pipe(Effect.mapError(withLaunchHint));
    return { address: handle.address, token: handle.token };
  });

/** One-shot CLI client with no reconnect timers. */
export function createPieClientFromEndpoint(endpoint: PieEndpoint): CloseablePieClient {
  const httpBase = new URL(endpoint.address);
  const wsUrl = new URL("/ws/rpc", httpBase);
  wsUrl.protocol = httpBase.protocol === "https:" ? "wss:" : "ws:";
  return createCloseablePieClient({
    url: wsUrl,
    ...(endpoint.token === undefined
      ? undefined
      : { getTicket: () => getWsTicket(httpBase, endpoint.token) }),
  });
}
