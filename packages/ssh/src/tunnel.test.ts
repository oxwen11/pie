import http from "node:http";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { forwardedConnection, reserveLoopbackPort, waitForHttpReady } from "./tunnel";

describe("forwardedConnection", () => {
  it("builds loopback HTTP and WS URLs without a path suffix", () => {
    expect(forwardedConnection(41234, "token")).toEqual({
      httpBaseUrl: "http://127.0.0.1:41234",
      wsBaseUrl: "ws://127.0.0.1:41234",
      token: "token",
    });
  });
});

describe("reserveLoopbackPort", () => {
  it("reserves an ephemeral 127.0.0.1 port", async () => {
    const port = await Effect.runPromise(reserveLoopbackPort());
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

describe("waitForHttpReady", () => {
  it("succeeds when /api/health answers ok", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/api/health") {
        response.end("ok");
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("expected a TCP address");
    }
    try {
      await expect(
        Effect.runPromise(
          waitForHttpReady({
            address: `http://127.0.0.1:${String(address.port)}`,
            timeoutMs: 2_000,
          }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fails when the health endpoint never answers ok", async () => {
    await expect(
      Effect.runPromise(
        waitForHttpReady({
          address: "http://127.0.0.1:1",
          timeoutMs: 400,
          probeTimeoutMs: 50,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "SshReadinessError" });
  });
});
