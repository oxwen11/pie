import http from "node:http";
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
});
