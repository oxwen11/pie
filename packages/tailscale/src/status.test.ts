import { describe, expect, it } from "vitest";

import { decodeTailscaleStatus, isTailscaleIpv4Address, stripTrailingDnsDot } from "./status";

const STATUS = {
  BackendState: "Running",
  Self: {
    HostName: "laptop",
    DNSName: "laptop.tailnet.ts.net.",
    TailscaleIPs: ["100.64.1.2", "fd7a:115c:a1e0::1"],
    Online: true,
  },
  Peer: {
    "nodekey:dev": {
      HostName: "devbox",
      DNSName: "devbox.tailnet.ts.net.",
      TailscaleIPs: ["100.64.9.9"],
      Online: true,
    },
    "nodekey:offline": {
      HostName: "sleeping",
      DNSName: "sleeping.tailnet.ts.net.",
      TailscaleIPs: ["100.100.0.1"],
      Online: false,
    },
    "nodekey:ip-only": {
      HostName: "bare",
      TailscaleIPs: ["100.71.0.8"],
      Online: true,
    },
    "nodekey:public": {
      HostName: "public",
      DNSName: "public.example.com.",
      TailscaleIPs: ["1.2.3.4"],
      Online: true,
    },
  },
};

describe("isTailscaleIpv4Address", () => {
  it("accepts CGNAT 100.64/10 and rejects the edges", () => {
    expect(isTailscaleIpv4Address("100.64.0.1")).toBe(true);
    expect(isTailscaleIpv4Address("100.127.255.254")).toBe(true);
    expect(isTailscaleIpv4Address("100.63.255.255")).toBe(false);
    expect(isTailscaleIpv4Address("100.128.0.1")).toBe(false);
    expect(isTailscaleIpv4Address("10.0.0.1")).toBe(false);
  });
});

describe("decodeTailscaleStatus", () => {
  it("reads Self MagicDNS, strips the trailing dot, and lists peers", () => {
    const status = decodeTailscaleStatus(JSON.stringify(STATUS));
    expect(status.backendState).toBe("Running");
    expect(status.magicDnsName).toBe("laptop.tailnet.ts.net");
    expect(status.tailnetIpv4Addresses).toEqual(["100.64.1.2"]);
    expect(status.peers).toEqual([
      {
        alias: "100.71.0.8",
        hostname: "100.71.0.8",
        online: true,
      },
      {
        alias: "devbox.tailnet.ts.net",
        hostname: "devbox.tailnet.ts.net",
        online: true,
      },
      {
        alias: "public.example.com",
        hostname: "public.example.com",
        online: true,
      },
      {
        alias: "sleeping.tailnet.ts.net",
        hostname: "sleeping.tailnet.ts.net",
        online: false,
      },
    ]);
  });

  it("skips Self in the peer list", () => {
    const status = decodeTailscaleStatus(JSON.stringify(STATUS));
    expect(status.peers.some((peer) => peer.hostname === status.magicDnsName)).toBe(false);
  });

  it("returns empty peers when the CLI is logged out", () => {
    const status = decodeTailscaleStatus(
      JSON.stringify({ BackendState: "NeedsLogin", Self: {}, Peer: null }),
    );
    expect(status.backendState).toBe("NeedsLogin");
    expect(status.magicDnsName).toBeNull();
    expect(status.peers).toEqual([]);
  });

  it("rejects non-object JSON", () => {
    expect(() => decodeTailscaleStatus("[]")).toThrowError(/status JSON/);
    expect(() => decodeTailscaleStatus("{")).toThrowError(/status JSON/);
  });
});

describe("stripTrailingDnsDot", () => {
  it("strips a single trailing dot", () => {
    expect(stripTrailingDnsDot("box.tailnet.ts.net.")).toBe("box.tailnet.ts.net");
    expect(stripTrailingDnsDot(" box.tailnet.ts.net. ")).toBe("box.tailnet.ts.net");
  });
});
