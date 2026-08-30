import http from "node:http";
import type { AddressInfo } from "node:net";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  DaemonClientError,
  DaemonProtocolUnsupportedError,
  issueDaemonBrowserPairing,
  issueDaemonWebSocketAccess,
} from "../../src/daemon/client";

let server: http.Server | undefined;

async function start(handler: http.RequestListener): Promise<{ address: string; token: string }> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { address: `http://127.0.0.1:${port}`, token: "master-secret-marker" };
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  server = undefined;
});

describe("privileged daemon client", () => {
  it("builds ticketed WebSocket access from the issuing endpoint", async () => {
    const endpoint = await start((request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${endpoint.token}`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ticket: "one-time-ticket-marker" }));
    });
    const access = await Effect.runPromise(issueDaemonWebSocketAccess(endpoint));
    const url = new URL(access.url);
    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe(new URL(endpoint.address).host);
    expect(url.pathname).toBe("/ws/rpc");
    expect(url.searchParams.has("ticket")).toBe(true);
  });

  it("mints a pairing URL only when the daemon advertises browser access", async () => {
    const endpoint = await start((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ grant: "one-time-grant-marker", expiresInSeconds: 60 }));
    });
    const pairing = await Effect.runPromise(issueDaemonBrowserPairing(endpoint));
    const url = new URL(pairing.url);
    expect(url.origin).toBe(endpoint.address);
    expect(url.pathname).toBe("/pair");
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#grant=")).toBe(true);
    expect(pairing.expiresInSeconds).toBe(60);
  });

  it("returns a typed restart-required error when browser pairing is unsupported", async () => {
    const endpoint = await start((_request, response) => {
      response.statusCode = 404;
      response.end("not found");
    });
    const error = await Effect.runPromise(Effect.flip(issueDaemonBrowserPairing(endpoint)));
    expect(error).toBeInstanceOf(DaemonProtocolUnsupportedError);
  });

  it("does not include credentials returned by a refused daemon in its error", async () => {
    const endpoint = await start((_request, response) => {
      response.statusCode = 401;
      response.end("one-time-secret-marker");
    });
    const error = await Effect.runPromise(Effect.flip(issueDaemonWebSocketAccess(endpoint)));
    expect(error).toBeInstanceOf(DaemonClientError);
    expect(JSON.stringify(error)).not.toContain(endpoint.token);
    expect(JSON.stringify(error)).not.toContain("one-time-secret-marker");
  });
});
