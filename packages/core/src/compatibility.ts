declare const gitHashDaemonCompatibilityKeyBrand: unique symbol;

export type GitHashDaemonCompatibilityKey = `githash:${string}` & {
  readonly [gitHashDaemonCompatibilityKeyBrand]: true;
};
export type ProtocolDaemonCompatibilityKey = `protocol:${number}`;

export type DaemonCompatibilityKey = GitHashDaemonCompatibilityKey | ProtocolDaemonCompatibilityKey;

/** Normalize a full or abbreviated Git hash to an eight-character namespaced key. */
export function makeGitHashDaemonCompatibilityKey(gitHash: string): GitHashDaemonCompatibilityKey {
  const normalized = gitHash.trim().toLowerCase();
  if (!/^[0-9a-f]{8,40}$/.test(normalized)) {
    throw new RangeError("Daemon Git hash must contain 8 to 40 hexadecimal characters");
  }
  return `githash:${normalized.slice(0, 8)}` as GitHashDaemonCompatibilityKey;
}

export function makeProtocolDaemonCompatibilityKey(
  version: number,
): ProtocolDaemonCompatibilityKey {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new RangeError("Daemon protocol version must be a positive safe integer");
  }
  return `protocol:${version}`;
}

/** Decode persisted JSON without trusting a TypeScript cast. */
export function decodeDaemonCompatibilityKey(value: unknown): DaemonCompatibilityKey | undefined {
  if (typeof value !== "string") return undefined;
  if (/^githash:[0-9a-f]{8}$/.test(value)) return value as GitHashDaemonCompatibilityKey;

  const match = /^protocol:([1-9]\d*)$/.exec(value);
  if (match === null) return undefined;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? (value as ProtocolDaemonCompatibilityKey) : undefined;
}

/** Read the statically embedded key; source entry points must inject it too. */
export function embeddedDaemonCompatibilityKey(
  value: unknown = process.env.PIE_DAEMON_COMPATIBILITY_KEY,
): DaemonCompatibilityKey {
  const decoded = decodeDaemonCompatibilityKey(value);
  if (decoded === undefined) {
    throw new Error(
      "PIE_DAEMON_COMPATIBILITY_KEY must be statically injected as githash:<8-hex> or protocol:<version>",
    );
  }
  return decoded;
}
