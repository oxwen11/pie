import { describe, expect, it } from "vitest";

import { mergeDiscoveredHosts } from "./merge-discovered-hosts";

describe("mergeDiscoveredHosts", () => {
  it("appends Tailscale peers and lets ssh-config win on the same alias", () => {
    const merged = mergeDiscoveredHosts(
      [
        {
          alias: "devbox",
          hostname: "devbox.tailnet.ts.net",
          username: null,
          port: null,
          source: "ssh-config",
        },
      ],
      [
        {
          alias: "devbox.tailnet.ts.net",
          hostname: "devbox.tailnet.ts.net",
          online: true,
        },
        {
          alias: "other.tailnet.ts.net",
          hostname: "other.tailnet.ts.net",
          online: true,
        },
      ],
    );

    expect(merged).toEqual([
      {
        alias: "devbox",
        hostname: "devbox.tailnet.ts.net",
        username: null,
        port: null,
        source: "ssh-config",
      },
      {
        alias: "other.tailnet.ts.net",
        hostname: "other.tailnet.ts.net",
        username: null,
        port: null,
        source: "tailscale",
      },
    ]);
  });

  it("skips a Tailscale host whose hostname is already in known_hosts", () => {
    const merged = mergeDiscoveredHosts(
      [
        {
          alias: "box.tailnet.ts.net",
          hostname: "box.tailnet.ts.net",
          username: null,
          port: null,
          source: "known-hosts",
        },
      ],
      [
        {
          alias: "box.tailnet.ts.net",
          hostname: "box.tailnet.ts.net",
          online: true,
        },
      ],
    );
    expect(merged).toEqual([
      {
        alias: "box.tailnet.ts.net",
        hostname: "box.tailnet.ts.net",
        username: null,
        port: null,
        source: "known-hosts",
      },
    ]);
  });
});
