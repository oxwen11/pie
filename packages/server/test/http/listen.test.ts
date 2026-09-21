import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { extraAllowedHostsForListen, isLoopbackBind, listenServer } from "../../src/http/listen";

const servers = new Set<ReturnType<typeof http.createServer>>();

const makeServer = () => {
  const server = http.createServer();
  servers.add(server);
  return server;
};

afterEach(async () => {
  await Promise.all(
    Array.from(servers, (server) =>
      server.listening
        ? new Promise<void>((resolve) => {
            server.close(() => resolve());
          })
        : Promise.resolve(),
    ),
  );
  servers.clear();
});

describe("extraAllowedHostsForListen", () => {
  it("adds a specific LAN address and ignores wildcard or loopback binds", () => {
    expect(extraAllowedHostsForListen("192.168.31.135")).toEqual(["192.168.31.135"]);
    expect(extraAllowedHostsForListen("0.0.0.0")).toEqual([]);
    expect(extraAllowedHostsForListen("127.0.0.1")).toEqual([]);
  });
});

describe("isLoopbackBind", () => {
  it("treats 127.0.0.1 as loopback and LAN or wildcard as not", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isLoopbackBind("192.168.31.135")).toBe(false);
  });
});

describe("listenServer", () => {
  it("returns an OS-assigned port", async () => {
    const port = await listenServer(makeServer(), 0);
    expect(port).toBeGreaterThan(0);
  });

  it("rejects instead of emitting an unhandled error when a port is occupied", async () => {
    const blocker = makeServer();
    const occupiedPort = await listenServer(blocker, 0);

    await expect(listenServer(makeServer(), occupiedPort)).rejects.toMatchObject({
      code: "EADDRINUSE",
      port: occupiedPort,
    });
    expect((blocker.address() as AddressInfo).port).toBe(occupiedPort);
  });
});
