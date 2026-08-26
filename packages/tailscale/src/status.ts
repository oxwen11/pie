import { Effect } from "effect";

import { runTailscaleCommand, TAILSCALE_STATUS_TIMEOUT_MS } from "./command";
import { TailscaleStatusParseError } from "./errors";

/** CGNAT range Tailscale assigns: 100.64.0.0/10. */
export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const first = Number.parseInt(parts[0] ?? "", 10);
  const second = Number.parseInt(parts[1] ?? "", 10);
  const third = Number.parseInt(parts[2] ?? "", 10);
  const fourth = Number.parseInt(parts[3] ?? "", 10);
  if (
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export function stripTrailingDnsDot(value: string): string {
  return value.trim().replace(/\.$/u, "");
}

export type TailscalePeerHost = {
  readonly alias: string;
  readonly hostname: string;
  readonly online: boolean;
};

export type TailscaleStatus = {
  readonly backendState: string | null;
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
  readonly peers: readonly TailscalePeerHost[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ipv4AddressesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const addresses: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && isTailscaleIpv4Address(entry)) addresses.push(entry);
  }
  return addresses;
}

function peerHostFromStatusNode(record: Record<string, unknown>): TailscalePeerHost | null {
  const dnsName = stringField(record, "DNSName");
  const hostname = dnsName === null ? null : stripTrailingDnsDot(dnsName);
  const ips = ipv4AddressesOf(record["TailscaleIPs"]);
  const resolved = hostname && hostname.length > 0 ? hostname : (ips[0] ?? null);
  if (resolved === null) return null;
  const online = record["Online"];
  return {
    alias: resolved,
    hostname: resolved,
    online: typeof online === "boolean" ? online : true,
  };
}

export function decodeTailscaleStatus(raw: string): TailscaleStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new TailscaleStatusParseError({
      message: "Failed to decode Tailscale status JSON.",
      cause,
    });
  }
  const root = asRecord(parsed);
  if (root === null) {
    throw new TailscaleStatusParseError({
      message: "Failed to decode Tailscale status JSON.",
    });
  }

  const backendState = stringField(root, "BackendState");
  const self = asRecord(root["Self"]);
  const magicDnsName = self === null ? null : (peerHostFromStatusNode(self)?.hostname ?? null);
  const tailnetIpv4Addresses = self === null ? [] : ipv4AddressesOf(self["TailscaleIPs"]);

  const peers: TailscalePeerHost[] = [];
  const seen = new Set<string>();
  const peerMap = asRecord(root["Peer"]);
  if (peerMap !== null) {
    for (const value of Object.values(peerMap)) {
      const node = asRecord(value);
      if (node === null) continue;
      const peer = peerHostFromStatusNode(node);
      if (peer === null) continue;
      const key = peer.hostname.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      peers.push(peer);
    }
  }

  return {
    backendState,
    magicDnsName,
    tailnetIpv4Addresses,
    peers: Array.from(peers).sort((left, right) => left.alias.localeCompare(right.alias)),
  };
}

export const parseTailscaleStatus = (
  raw: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  Effect.try({
    try: () => decodeTailscaleStatus(raw),
    catch: (cause) =>
      cause instanceof TailscaleStatusParseError
        ? cause
        : new TailscaleStatusParseError({
            message: "Failed to decode Tailscale status JSON.",
            cause,
          }),
  });

export const readTailscaleStatus = runTailscaleCommand(
  ["status", "--json"],
  TAILSCALE_STATUS_TIMEOUT_MS,
).pipe(Effect.flatMap((result) => parseTailscaleStatus(result.stdout)));

/** Online tailnet peers as SSH hosts. Missing CLI or status errors become `[]`. */
export const listOnlineTailscaleSshHosts = readTailscaleStatus.pipe(
  Effect.map((status) => status.peers.filter((peer) => peer.online)),
  Effect.orElseSucceed((): readonly TailscalePeerHost[] => []),
);
