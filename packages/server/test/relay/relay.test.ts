import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { attachRelay } from "../../src/relay/attach";
import { listenRelay } from "../../src/relay/listen";
import { isPrivateOrTailnetHop, relayPublicBaseUrl } from "../../src/relay/protocol";

describe("relayPublicBaseUrl", () => {
  it("advertises the public hop and rejects Tailscale, LAN, and loopback", () => {
    expect(relayPublicBaseUrl({ host: "96.44.165.19", port: 8443 })).toBe(
      "http://96.44.165.19:8443",
    );
    expect(() => relayPublicBaseUrl({ host: "100.88.65.47", port: 8443 })).toThrow(/public hop/);
    expect(() =>
      relayPublicBaseUrl({ host: "racknerd-5617bf0.tail590c10.ts.net", port: 8443 }),
    ).toThrow(/public hop/);
    expect(() => relayPublicBaseUrl({ host: "192.168.31.135", port: 8443 })).toThrow(/public hop/);
    expect(() => relayPublicBaseUrl({ host: "127.0.0.1", port: 8443 })).toThrow(/public hop/);
  });

  it("treats MagicDNS and 100.x as private hops", () => {
    expect(isPrivateOrTailnetHop("mac-mini.tail590c10.ts.net")).toBe(true);
    expect(isPrivateOrTailnetHop("100.78.197.55")).toBe(true);
    expect(isPrivateOrTailnetHop("96.44.165.19")).toBe(false);
  });
});

describe("listenRelay + attachRelay", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const close = cleanups.pop();
      if (close) await close();
    }
  });

  it("forwards HTTP from the advertised public hop through an outbound attach", async () => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      backend.listen(0, "127.0.0.1", resolve);
    });
    const backendPort = (backend.address() as AddressInfo).port;
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          backend.close(() => resolve());
        }),
    );

    const relay = await listenRelay({
      port: 0,
      token: "relay-token-test",
      publicHost: "96.44.165.19",
      host: "127.0.0.1",
    });
    cleanups.push(relay.close);
    expect(relay.publicBaseUrl).toBe(`http://96.44.165.19:${String(relay.port)}`);
    expect(relay.publicBaseUrl).not.toMatch(/100\.|ts\.net|192\.168\.31/);

    const attach = await attachRelay({
      relayHost: "127.0.0.1",
      relayPort: relay.controlPort,
      token: "relay-token-test",
      localHost: "127.0.0.1",
      localPort: backendPort,
    });
    cleanups.push(attach.close);

    const hop = `http://127.0.0.1:${String(relay.port)}/api/health`;
    const response = await fetch(hop);
    await expect(response.text()).resolves.toBe("ok");

    await attach.close();
    await expect(fetch(hop, { signal: AbortSignal.timeout(2000) })).rejects.toThrow(
      /fetch|abort|ECONNREFUSED/i,
    );
  });

  it("rejects a bad token instead of hanging", async () => {
    const relay = await listenRelay({
      port: 0,
      token: "relay-token-test",
      publicHost: "96.44.165.19",
      host: "127.0.0.1",
    });
    cleanups.push(relay.close);
    await expect(
      attachRelay({
        relayHost: "127.0.0.1",
        relayPort: relay.controlPort,
        token: "wrong-token",
        localHost: "127.0.0.1",
        localPort: 9,
      }),
    ).rejects.toThrow(/closed|accept|timed out/i);
  });

  it("releases the public port when the control port cannot bind", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          blocker.close(() => resolve());
        }),
    );
    const controlPort = (blocker.address() as AddressInfo).port;
    const publicServer = net.createServer();
    await new Promise<void>((resolve, reject) => {
      publicServer.once("error", reject);
      publicServer.listen(0, "127.0.0.1", () => resolve());
    });
    const publicPort = (publicServer.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      publicServer.close(() => resolve());
    });

    await expect(
      listenRelay({
        port: publicPort,
        controlPort,
        token: "relay-token-test",
        publicHost: "96.44.165.19",
        host: "127.0.0.1",
      }),
    ).rejects.toThrow(/EADDRINUSE|listen/i);

    const reused = net.createServer();
    await new Promise<void>((resolve, reject) => {
      reused.once("error", reject);
      reused.listen(publicPort, "127.0.0.1", () => resolve());
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          reused.close(() => resolve());
        }),
    );
    expect((reused.address() as AddressInfo).port).toBe(publicPort);
  });

  it("destroys a waiting public client when the data hop never arrives", async () => {
    const relay = await listenRelay({
      port: 0,
      token: "relay-token-test",
      publicHost: "96.44.165.19",
      host: "127.0.0.1",
      waitingTimeoutMs: 50,
    });
    cleanups.push(relay.close);

    const control = net.connect({ host: "127.0.0.1", port: relay.controlPort });
    cleanups.push(async () => {
      control.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      control.once("error", reject);
      const onData = (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("PIE-RELAY-READY")) {
          control.off("data", onData);
          resolve();
        }
      };
      control.on("data", onData);
      control.write("PIE-RELAY-CONTROL relay-token-test\n");
    });

    const client = net.connect({ host: "127.0.0.1", port: relay.port });
    const closed = new Promise<void>((resolve) => {
      client.once("close", () => resolve());
    });
    await expect(closed).resolves.toBeUndefined();
  });
});
