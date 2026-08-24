import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { daemonLiveness, healthy, pidAlive, probeHealth } from "../../src/daemon/liveness";

function stubServer(handler: (res: http.ServerResponse) => void): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/health") return handler(res);
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
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

describe("daemonLiveness", () => {
  it("reports a missing process with identity and consecutive misses", async () => {
    await expect(
      Effect.runPromise(
        daemonLiveness(
          {
            pid: 2_147_483_646,
            address: "http://127.0.0.1:43123",
          },
          2,
        ),
      ),
    ).resolves.toEqual({
      status: "process_missing",
      pid: 2_147_483_646,
      address: "http://127.0.0.1:43123",
      port: 43123,
      consecutiveMisses: 3,
    });
  });
});

describe("healthy", () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it("is true when /api/health answers ok", async () => {
    server = await stubServer((res) => res.end("ok"));
    expect(await Effect.runPromise(healthy(addressOf(server)))).toBe(true);
  });

  it("is false on a non-ok status", async () => {
    server = await stubServer((res) => {
      res.statusCode = 500;
      res.end("ok");
    });
    expect(await Effect.runPromise(healthy(addressOf(server)))).toBe(false);
  });

  it("is false when the body is not ok", async () => {
    server = await stubServer((res) => res.end("nope"));
    expect(await Effect.runPromise(healthy(addressOf(server)))).toBe(false);
  });

  it("is false when nothing is listening", async () => {
    expect(await Effect.runPromise(healthy("http://127.0.0.1:1"))).toBe(false);
  });

  it("times out instead of hanging on a wedged server that never responds", async () => {
    // Accepts the TCP connection but never writes an HTTP response.
    const wedged = await new Promise<import("node:net").Server>((resolve) => {
      const listener = net.createServer(() => {});
      listener.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
      const port = (wedged.address() as AddressInfo).port;
      const address = `http://127.0.0.1:${port}`;
      const started = Date.now();
      expect(await Effect.runPromise(healthy(address))).toBe(false);
      expect(Date.now() - started).toBeLessThan(5_000);

      await expect(
        Effect.runPromise(probeHealth(address, AbortSignal.timeout(30))),
      ).resolves.toMatchObject({
        status: "health_timeout",
        address,
        port,
        probeError: expect.stringMatching(/TimeoutError/),
      });
    } finally {
      wedged.close();
    }
  });
});
