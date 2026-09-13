import net from "node:net";

/** First line of the daemon's long-lived control connection. */
export const RELAY_CONTROL_PREFIX = "PIE-RELAY-CONTROL ";

/** First line of a per-client data connection the daemon opens outbound. */
export const RELAY_DATA_PREFIX = "PIE-RELAY-DATA ";

/** Control-channel line: a public client is waiting for this stream. */
export const RELAY_OPEN_PREFIX = "OPEN ";

/** Listen writes this once the daemon control connection is accepted. */
export const RELAY_READY = "PIE-RELAY-READY";

const TAILSCALE_CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.replace(/:\d+$/, "");
}

/**
 * True when `host` is loopback, RFC1918, Tailscale CGNAT (`100.64/10`), or
 * MagicDNS. The relay hop the client uses must not be any of these.
 */
export function isPrivateOrTailnetHop(host: string): boolean {
  const hostname = hostnameOf(host);
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.endsWith(".ts.net")) return true;
  if (TAILSCALE_CGNAT.test(hostname) || hostname.startsWith("100.")) return true;
  if (hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("10.")) return true;
  return /^(172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname);
}

export function relayPublicBaseUrl(input: {
  readonly host: string;
  readonly port: number;
}): string {
  const host = input.host.trim();
  if (host.length === 0 || isPrivateOrTailnetHop(host)) {
    throw new Error(
      "Relay public hop must be a public address, not Tailscale, LAN, MagicDNS, or loopback",
    );
  }
  return `http://${host}:${String(input.port)}`;
}

/** Bidirectional byte pipe used by both listen and attach. Honors backpressure. */
export function pipeSockets(left: net.Socket, right: net.Socket): void {
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    left.destroy();
    right.destroy();
  };
  left.on("error", drop);
  right.on("error", drop);
  left.pipe(right);
  right.pipe(left);
}
