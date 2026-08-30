import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { BROWSER_SESSION_COOKIE, type AccessAuthority, type AccessPrincipal } from "./access";
import { corsHeaders, isLoopbackHost } from "./cors";
import { PIE_HTTP_PROTOCOL_VERSION, PIE_PROTOCOL_HEADER } from "./protocol";
import type { UIApp } from "./ui";

export type RequestAppOptions = {
  readonly access: AccessAuthority;
  /** Extra cross-origin allowlist entries on top of the built-in trusted set. */
  readonly corsOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
  /** Present only for authenticated daemon mode. Must return before shutdown starts. */
  readonly shutdown: (() => void) | undefined;
  /** Everything the API routes below do not claim. */
  readonly ui: UIApp;
};

const forbidden = HttpServerResponse.text("Forbidden", { status: 403 });
const unauthorized = HttpServerResponse.text("Unauthorized", { status: 401 });
const badRequest = HttpServerResponse.text("Bad Request", { status: 400 });
const payloadTooLarge = HttpServerResponse.text("Payload Too Large", { status: 413 });
const notFound = HttpServerResponse.text("Not Found", { status: 404 });
const PAIRING_BODY_LIMIT_BYTES = 1_024;

function noStore(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.setHeader(response, "cache-control", "no-store");
}

function sameLoopbackOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || host === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
  } catch {
    return false;
  }
}

function pairingGrantBody(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<string | null> {
  const contentLength = request.headers["content-length"];
  if (contentLength === undefined || !/^\d+$/.test(contentLength)) return Effect.succeed(null);
  if (Number(contentLength) > PAIRING_BODY_LIMIT_BYTES) return Effect.succeed("too-large");
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    return Effect.succeed(null);
  }
  return request.json.pipe(
    Effect.map((body) => {
      if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
      const record = body as Record<string, unknown>;
      const keys = Object.keys(record);
      return keys.length === 1 && keys[0] === "grant" && typeof record.grant === "string"
        ? record.grant
        : null;
    }),
    Effect.catch(() => Effect.succeed(null)),
  );
}

function authenticate(
  access: AccessAuthority,
  request: HttpServerRequest.HttpServerRequest,
): AccessPrincipal | null {
  return access.authenticateHttp({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
  });
}

/**
 * The request half of the server. The WebSocket upgrade half stays on raw
 * `node:http` (see `server.ts`) because oRPC owns that event.
 *
 * Deliberately a plain sequence rather than an `HttpRouter`: the order here
 * *is* the security policy — rebinding, CORS, public auth bootstrap, principal
 * authentication, privileged routes, API fallback, then static UI.
 */
export const makeRequestApp = (
  options: RequestAppOptions,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  route(options).pipe(
    Effect.tap((response) =>
      response.status < 400
        ? Effect.void
        : HttpServerRequest.HttpServerRequest.pipe(
            Effect.flatMap((request) => {
              const path = new URL(request.url, "http://localhost").pathname;
              const annotations = {
                event: "http.refused",
                status: response.status,
                method: request.method,
                path,
                ...(request.headers.origin !== undefined
                  ? { origin: request.headers.origin }
                  : undefined),
                ...(request.headers.host !== undefined
                  ? { host: request.headers.host }
                  : undefined),
              };
              const routine = response.status === 404 && !path.startsWith("/api/");
              return routine
                ? Effect.logDebug("http request not found").pipe(Effect.annotateLogs(annotations))
                : Effect.logWarning("http request refused").pipe(Effect.annotateLogs(annotations));
            }),
          ),
    ),
  );

const route = (
  options: RequestAppOptions,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (!isLoopbackHost(request.headers.host, options.allowedHosts)) return forbidden;

    const headers = corsHeaders(request.headers.origin, {
      extraOrigins: options.corsOrigins,
      allowedHosts: options.allowedHosts,
    });
    const withCors = (response: HttpServerResponse.HttpServerResponse) =>
      headers ? HttpServerResponse.setHeaders(response, headers) : response;

    if (request.method === "OPTIONS") {
      return withCors(HttpServerResponse.empty({ status: headers ? 204 : 403 }));
    }

    const pathname = new URL(request.url, "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/api/health") {
      return withCors(
        HttpServerResponse.setHeader(
          HttpServerResponse.text("ok"),
          PIE_PROTOCOL_HEADER,
          String(PIE_HTTP_PROTOCOL_VERSION),
        ),
      );
    }

    if (request.method === "GET" && pathname === "/api/auth/session") {
      return withCors(
        noStore(
          HttpServerResponse.jsonUnsafe(
            options.access.inspectBrowserSession(request.headers.cookie),
          ),
        ),
      );
    }

    if (request.method === "POST" && pathname === "/api/auth/browser-session") {
      if (!sameLoopbackOrigin(request.headers.origin, request.headers.host)) {
        return withCors(forbidden);
      }
      const grant = yield* pairingGrantBody(request);
      if (grant === "too-large") return withCors(payloadTooLarge);
      if (grant === null) return withCors(badRequest);
      const session = options.access.exchangePairingGrant(grant);
      if (session === null) return withCors(unauthorized);
      return withCors(
        noStore(
          HttpServerResponse.setHeader(
            HttpServerResponse.jsonUnsafe({ authenticated: true }),
            "set-cookie",
            `${BROWSER_SESSION_COOKIE}=${session.cookieValue}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${session.maxAgeSeconds}`,
          ),
        ),
      );
    }

    const principal = authenticate(options.access, request);
    if (pathname.startsWith("/api/") && principal === null) return withCors(unauthorized);

    if (request.method === "POST" && pathname === "/api/auth/pairing-grants") {
      const issued = options.access.issuePairingGrant(principal!);
      return withCors(issued === null ? forbidden : noStore(HttpServerResponse.jsonUnsafe(issued)));
    }

    if (
      request.method === "POST" &&
      pathname === "/api/shutdown" &&
      options.shutdown !== undefined
    ) {
      if (principal?.kind !== "master") return withCors(forbidden);
      options.shutdown();
      return withCors(HttpServerResponse.text("shutting down", { status: 202 }));
    }

    if (request.method === "POST" && pathname === "/api/ws-ticket") {
      return withCors(
        noStore(
          HttpServerResponse.jsonUnsafe({
            ticket: options.access.issueWebSocketTicket(principal!),
          }),
        ),
      );
    }

    if (pathname.startsWith("/api/")) return withCors(notFound);

    if (headers) {
      const nodeResponse = NodeHttpServerRequest.toServerResponse(request);
      for (const [name, value] of Object.entries(headers)) nodeResponse.setHeader(name, value);
    }
    return withCors(yield* options.ui);
  });
