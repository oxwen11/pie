import crypto from "node:crypto";

import { Effect } from "effect";

import { SshInvalidTargetError } from "./errors";

/** An SSH destination the desktop can launch a remote pie daemon on. */
export type SshTarget = {
  /** ssh_config Host or hostname. Never includes `user@` or `:port`. */
  readonly alias: string;
  readonly hostname: string;
  readonly username: string | null;
  readonly port: number | null;
};

export type DiscoveredSshHost = SshTarget & {
  readonly source: "ssh-config";
};

/** Result of launching or attaching to the remote pie daemon. */
export type RemoteLaunchResult = {
  readonly remotePort: number;
  readonly token: string;
  /** Remote `os.hostname()` after launch. Display only — not an SSH destination. */
  readonly hostname?: string;
  /** Daemon record key. Missing means the client must not connect. */
  readonly compatibilityKey?: string;
};

/** Substring the desktop toast already matches. Remote must upgrade; do not attach. */
export const REMOTE_DAEMON_MISMATCH_MESSAGE =
  "pie daemon is already running with a different version. Update Pie on that machine to match this client, then connect.";

/** Exact key match only. Empty or missing remote key is a mismatch. */
export function remoteDaemonCompatibilityMatches(
  actual: string | undefined,
  required: string,
): boolean {
  return required.length > 0 && actual === required;
}

/** Loopback URLs plus the daemon token after the local forward is up. */
export type SshEnvironmentBootstrap = {
  readonly target: SshTarget;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly token: string;
  readonly remotePort: number;
  /** Remote `os.hostname()` after launch. Display only — not an SSH destination. */
  readonly reportedHostname?: string;
};

const IPV6_HOST = /^\[([^\]]+)\](?::(\d+))?$/u;

/** Parse `user@host`, `host:port`, `user@host:port`, or a bare alias. */
export function parseSshInput(raw: string): SshTarget {
  let remainder = raw.trim();
  let username: string | null = null;

  const at = remainder.lastIndexOf("@");
  if (at > 0) {
    username = remainder.slice(0, at);
    remainder = remainder.slice(at + 1);
  }

  let hostname = remainder;
  let port: number | null = null;
  const ipv6 = IPV6_HOST.exec(remainder);
  if (ipv6) {
    hostname = ipv6[1] ?? remainder;
    const parsed = ipv6[2] === undefined ? Number.NaN : Number.parseInt(ipv6[2], 10);
    port = Number.isInteger(parsed) ? parsed : null;
  } else {
    const colon = remainder.lastIndexOf(":");
    if (colon > 0 && remainder.indexOf(":") === colon) {
      const parsed = Number.parseInt(remainder.slice(colon + 1), 10);
      if (Number.isInteger(parsed)) {
        hostname = remainder.slice(0, colon);
        port = parsed;
      }
    }
  }

  // `alias` is the ssh destination host (config Host or hostname), never `user@`.
  return { alias: hostname, hostname, username, port };
}

export function parseSshResolveOutput(alias: string, stdout: string): SshTarget {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [key, ...rest] = trimmed.split(/\s+/u);
    if (!key || rest.length === 0 || values.has(key)) continue;
    values.set(key, rest.join(" ").trim());
  }

  const rawHostname = values.get("hostname")?.trim();
  const hostname = rawHostname === undefined || rawHostname.length === 0 ? alias : rawHostname;
  const rawUser = values.get("user")?.trim();
  const username = rawUser === undefined || rawUser.length === 0 ? null : rawUser;
  const rawPort = values.get("port")?.trim() ?? "";
  const parsedPort = Number.parseInt(rawPort, 10);

  return {
    alias,
    hostname,
    username,
    port: Number.isInteger(parsedPort) ? parsedPort : null,
  };
}

/** Typed username/port win; hostname always comes from `ssh -G`. */
export function overlaySshTarget(resolved: SshTarget, typed: SshTarget): SshTarget {
  return {
    alias: typed.alias || resolved.alias,
    hostname: resolved.hostname,
    username: typed.username ?? resolved.username,
    port: typed.port ?? resolved.port,
  };
}

export function targetConnectionKey(target: SshTarget): string {
  return `${target.alias}\u0000${target.hostname}\u0000${target.username ?? ""}\u0000${target.port ?? ""}`;
}

/** Stable remote state directory name — 16 hex chars of the connection key. */
export function remoteStateKey(target: SshTarget): string {
  return crypto.createHash("sha256").update(targetConnectionKey(target)).digest("hex").slice(0, 16);
}

function hostNeedsBrackets(host: string): boolean {
  return host.includes(":") && !host.startsWith("[");
}

function sshDestinationHost(target: SshTarget): string {
  const host = target.alias.trim() || target.hostname.trim();
  return hostNeedsBrackets(host) ? `[${host}]` : host;
}

/** `user@host` for OpenSSH. `alias` is the config Host (no user), so this never doubles `user@`. */
export function buildSshHostSpec(target: SshTarget): string {
  const destination = sshDestinationHost(target);
  if (destination.length === 0) {
    throw new Error("SSH target is missing its alias/hostname.");
  }
  return target.username ? `${target.username}@${destination}` : destination;
}

/** Reconnect string for `resolveSshInput` — preserves typed user/port and the config alias. */
export function formatSshInput(target: SshTarget): string {
  const host = sshDestinationHost(target);
  const withUser = target.username ? `${target.username}@${host}` : host;
  return target.port !== null ? `${withUser}:${String(target.port)}` : withUser;
}

export const buildSshHostSpecEffect = (
  target: SshTarget,
): Effect.Effect<string, SshInvalidTargetError> =>
  Effect.try({
    try: () => buildSshHostSpec(target),
    catch: (cause) =>
      new SshInvalidTargetError({
        message: cause instanceof Error ? cause.message : "SSH target is invalid.",
      }),
  });

export function environmentLabel(target: SshTarget, reportedHostname?: string): string {
  const typed = target.alias.trim() || target.hostname.trim();
  const reported = reportedHostname?.trim();
  const extra =
    reported !== undefined && reported.length > 0 && reported !== typed
      ? reported
      : target.hostname.trim() !== typed
        ? target.hostname.trim()
        : "";
  const host = extra.length > 0 ? `${typed} (${extra})` : typed;
  return target.username ? `${target.username}@${host}` : host;
}

/** Last `{...}` object in mixed SSH stdout (daemon chatter, then launch JSON). */
export function extractJsonObject(stdout: string): string {
  const start = stdout.lastIndexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start !== -1 && end > start) return stdout.slice(start, end + 1);
  return stdout.trim();
}

export function parseRemoteLaunchOutput(stdout: string): RemoteLaunchResult | undefined {
  const raw = extractJsonObject(stdout);
  if (raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as {
      remotePort?: unknown;
      token?: unknown;
      hostname?: unknown;
      compatibilityKey?: unknown;
    };
    if (
      typeof record.remotePort !== "number" ||
      !Number.isInteger(record.remotePort) ||
      record.remotePort <= 0 ||
      typeof record.token !== "string" ||
      record.token.length === 0
    ) {
      return undefined;
    }
    const hostname =
      typeof record.hostname === "string" && record.hostname.trim().length > 0
        ? record.hostname.trim()
        : undefined;
    const compatibilityKey =
      typeof record.compatibilityKey === "string" && record.compatibilityKey.length > 0
        ? record.compatibilityKey
        : undefined;
    return {
      remotePort: record.remotePort,
      token: record.token,
      ...(hostname === undefined ? undefined : { hostname }),
      ...(compatibilityKey === undefined ? undefined : { compatibilityKey }),
    };
  } catch {
    return undefined;
  }
}
