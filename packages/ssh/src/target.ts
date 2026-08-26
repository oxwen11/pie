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
  readonly source: "ssh-config" | "known-hosts";
};

export type RemoteServerKind = "daemon";

/** Result of launching or attaching to the remote pie daemon. */
export type RemoteLaunchResult = {
  readonly remotePort: number;
  readonly token: string;
  readonly serverKind: RemoteServerKind;
};

/** Loopback URLs plus the daemon token after the local forward is up. */
export type SshEnvironmentBootstrap = {
  readonly target: SshTarget;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly token: string;
  readonly remotePort: number;
  readonly remoteServerKind: RemoteServerKind;
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

  const hostname = values.get("hostname")?.trim() || alias;
  const username = values.get("user")?.trim() || null;
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

export function environmentLabel(target: SshTarget): string {
  if (target.username) return `${target.username}@${target.hostname}`;
  return target.alias.trim() || target.hostname;
}

export function getLastNonEmptyOutputLine(stdout: string): string | null {
  const lines = stdout
    .trim()
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return lines.length === 0 ? null : (lines[lines.length - 1] ?? null);
}

/** Last `{...}` object in mixed SSH stdout (daemon chatter, then launch JSON). */
export function extractJsonObject(stdout: string): string {
  const start = stdout.lastIndexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start >= 0 && end > start) return stdout.slice(start, end + 1);
  return stdout.trim();
}

export function parseRemoteLaunchOutput(stdout: string): RemoteLaunchResult | undefined {
  const candidates = [extractJsonObject(stdout), getLastNonEmptyOutputLine(stdout) ?? ""];
  for (const raw of candidates) {
    if (raw.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed as {
        remotePort?: unknown;
        token?: unknown;
        serverKind?: unknown;
      };
      if (
        typeof record.remotePort !== "number" ||
        !Number.isInteger(record.remotePort) ||
        record.remotePort <= 0 ||
        typeof record.token !== "string" ||
        record.token.length === 0 ||
        record.serverKind !== "daemon"
      ) {
        continue;
      }
      return {
        remotePort: record.remotePort,
        token: record.token,
        serverKind: "daemon",
      };
    } catch {
      continue;
    }
  }
  return undefined;
}
