import type { TailscalePeerHost } from "@getpie/tailscale";

import type { DiscoveredSshHost } from "../../shared/desktop-rpc";

type ConfigHost = {
  readonly alias: string;
  readonly hostname: string;
  readonly username: string | null;
  readonly port: number | null;
  readonly source: "ssh-config" | "known-hosts";
};

export function mergeDiscoveredHosts(
  sshHosts: readonly ConfigHost[],
  tailscaleHosts: readonly TailscalePeerHost[],
): DiscoveredSshHost[] {
  const seen = new Set<string>();
  const merged: DiscoveredSshHost[] = [];

  const remember = (alias: string, hostname: string) => {
    seen.add(alias.toLowerCase());
    seen.add(hostname.toLowerCase());
  };

  const alreadySeen = (alias: string, hostname: string) =>
    seen.has(alias.toLowerCase()) || seen.has(hostname.toLowerCase());

  for (const host of sshHosts) {
    remember(host.alias, host.hostname);
    merged.push(host);
  }

  for (const host of tailscaleHosts) {
    if (alreadySeen(host.alias, host.hostname)) continue;
    remember(host.alias, host.hostname);
    merged.push({
      alias: host.alias,
      hostname: host.hostname,
      username: null,
      port: null,
      source: "tailscale",
    });
  }

  return Array.from(merged).sort((left, right) => left.alias.localeCompare(right.alias));
}
