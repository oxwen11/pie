import { Data, Effect } from "effect";

import {
  BROWSER_ACCESS_MIN_PROTOCOL_VERSION,
  PIE_PROTOCOL_HEADER,
  parseProtocolVersion,
} from "../http/protocol";

export type DaemonEndpoint = {
  readonly address: string;
  readonly token: string;
};

export class DaemonClientError extends Data.TaggedError("DaemonClientError")<{
  readonly operation: "health" | "websocket-access" | "browser-pairing";
  readonly status?: number;
  readonly message: string;
}> {}

export class DaemonProtocolUnsupportedError extends Data.TaggedError(
  "DaemonProtocolUnsupportedError",
)<{
  readonly requiredVersion: number;
  readonly actualVersion?: number;
}> {}

function postAuthenticated(
  endpoint: DaemonEndpoint,
  pathname: string,
  operation: DaemonClientError["operation"],
): Effect.Effect<Response, DaemonClientError> {
  return Effect.tryPromise({
    try: () =>
      fetch(new URL(pathname, endpoint.address), {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}` },
      }),
    catch: () =>
      new DaemonClientError({ operation, message: `Daemon ${operation} request failed` }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new DaemonClientError({
              operation,
              status: response.status,
              message: `Daemon ${operation} request was refused`,
            }),
          ),
    ),
  );
}

function jsonRecord(
  response: Response,
  operation: DaemonClientError["operation"],
): Effect.Effect<Record<string, unknown>, DaemonClientError> {
  return Effect.tryPromise({
    try: async () => {
      const value = (await response.json()) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Expected a JSON object");
      }
      return value as Record<string, unknown>;
    },
    catch: () =>
      new DaemonClientError({ operation, message: `Daemon ${operation} response was invalid` }),
  });
}

export const inspectDaemonProtocol = (
  endpoint: Pick<DaemonEndpoint, "address">,
): Effect.Effect<number | undefined, DaemonClientError> =>
  Effect.tryPromise({
    try: () => fetch(new URL("/api/health", endpoint.address)),
    catch: () =>
      new DaemonClientError({ operation: "health", message: "Daemon health request failed" }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(parseProtocolVersion(response.headers.get(PIE_PROTOCOL_HEADER)))
        : Effect.fail(
            new DaemonClientError({
              operation: "health",
              status: response.status,
              message: "Daemon health request was refused",
            }),
          ),
    ),
  );

export const issueDaemonWebSocketAccess = (
  endpoint: DaemonEndpoint,
): Effect.Effect<{ readonly url: string }, DaemonClientError> =>
  Effect.gen(function* () {
    const response = yield* postAuthenticated(endpoint, "/api/ws-ticket", "websocket-access");
    const body = yield* jsonRecord(response, "websocket-access");
    if (typeof body.ticket !== "string" || body.ticket.length === 0) {
      return yield* Effect.fail(
        new DaemonClientError({
          operation: "websocket-access",
          message: "Daemon websocket-access response was invalid",
        }),
      );
    }
    const url = new URL("/ws/rpc", endpoint.address);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", body.ticket);
    return { url: url.toString() };
  });

export const issueDaemonBrowserPairing = (
  endpoint: DaemonEndpoint,
): Effect.Effect<
  { readonly url: string; readonly expiresInSeconds: number },
  DaemonClientError | DaemonProtocolUnsupportedError
> =>
  Effect.gen(function* () {
    const protocolVersion = yield* inspectDaemonProtocol(endpoint);
    if (protocolVersion === undefined || protocolVersion < BROWSER_ACCESS_MIN_PROTOCOL_VERSION) {
      return yield* Effect.fail(
        new DaemonProtocolUnsupportedError({
          requiredVersion: BROWSER_ACCESS_MIN_PROTOCOL_VERSION,
          ...(protocolVersion === undefined ? undefined : { actualVersion: protocolVersion }),
        }),
      );
    }

    const response = yield* postAuthenticated(
      endpoint,
      "/api/auth/pairing-grants",
      "browser-pairing",
    );
    const body = yield* jsonRecord(response, "browser-pairing");
    if (
      typeof body.grant !== "string" ||
      body.grant.length === 0 ||
      typeof body.expiresInSeconds !== "number"
    ) {
      return yield* Effect.fail(
        new DaemonClientError({
          operation: "browser-pairing",
          message: "Daemon browser-pairing response was invalid",
        }),
      );
    }
    const url = new URL("/pair", endpoint.address);
    url.hash = new URLSearchParams({ grant: body.grant }).toString();
    return { url: url.toString(), expiresInSeconds: body.expiresInSeconds };
  });
