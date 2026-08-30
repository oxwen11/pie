import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { healthy, pidAlive, probeHealth } from "../../src/daemon/liveness";
import { PIE_PROTOCOL_HEADER } from "../../src/http/protocol";

function stubServer(handler: (res: http.ServerResponse) => void): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/health") return handler(res);
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function addressOf(server: http.Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("pidAlive", () => {
  it("is true for this process and false for impossible pids", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2_147_483_646)).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });
});

describe("healthy", () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it("is true when /api/health answers ok", async () => {
    server = await stubServer((res) => res.end("ok"));
    await expect(Effect.runPromise(healthy(addressOf(server)))).resolves.toBe(true);
  });

  it("reports an optional protocol version without changing legacy health", async () => {
    server = await stubServer((res) => {
      res.setHeader(PIE_PROTOCOL_HEADER, "2");
      res.end("ok");
    });
    await expect(Effect.runPromise(probeHealth(addressOf(server)))).resolves.toEqual({
      healthy: true,
      protocolVersion: 2,
    });
  });

  it("treats a missing protocol header as a healthy legacy daemon", async () => {
    server = await stubServer((res) => res.end("ok"));
    await expect(Effect.runPromise(probeHealth(addressOf(server)))).resolves.toEqual({
      healthy: true,
    });
  });

  it("is false on a non-ok status", async () => {
    server = await stubServer((res) => {
      res.statusCode = 500;
      res.end("ok");
    });
    await expect(Effect.runPromise(healthy(addressOf(server)))).resolves.toBe(false);
  });

  it("is false when the body is not ok", async () => {
    server = await stubServer((res) => res.end("nope"));
    await expect(Effect.runPromise(healthy(addressOf(server)))).resolves.toBe(false);
  });

  it("is false when nothing is listening", async () => {
    await expect(Effect.runPromise(healthy("http://127.0.0.1:1"))).resolves.toBe(false);
  });

  it("times out instead of hanging on a wedged server that never responds", async () => {
    // Accepts the TCP connection but never writes an HTTP response.
    const wedged = await new Promise<import("node:net").Server>((resolve) => {
      const listener = net.createServer(() => {});
      listener.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
      const port = (wedged.address() as AddressInfo).port;
      const started = Date.now();
      await expect(Effect.runPromise(healthy(`http://127.0.0.1:${port}`))).resolves.toBe(false);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      wedged.close();
    }
  });
});
