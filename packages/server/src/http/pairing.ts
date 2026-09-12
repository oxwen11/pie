import crypto from "node:crypto";

/** How long a minted pairing code stays redeemable. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const SESSION_TOKEN_BYTES = 32;

export type PairingMint = {
  readonly code: string;
  readonly expiresAt: number;
};

export type PairingSession = {
  readonly token: string;
  readonly environmentId: string;
};

export type PairingStore = {
  mint(): PairingMint;
  exchange(code: string): PairingSession | null;
  accepts(token: string | null): boolean;
  readonly environmentId: string;
};

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) break;
    const letter = CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (letter !== undefined) out += letter;
  }
  return out;
}

export function normalizePairingCode(code: string): string {
  return code.trim().toUpperCase().replaceAll("-", "");
}

export function parsePairingExchange(raw: string): { code: string } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const code = (parsed as { code?: unknown }).code;
    if (typeof code !== "string" || normalizePairingCode(code).length === 0) return null;
    return { code };
  } catch {
    return null;
  }
}

/**
 * One-time pairing codes that mint a reload-stable session token. The daemon
 * token never leaves the operator machine; browsers keep only this session.
 */
export function createPairingStore(input: {
  readonly environmentId: string;
  readonly now?: () => number;
}): PairingStore {
  const now = input.now ?? Date.now;
  const pending = new Map<string, number>();
  const sessions = new Set<string>();
  const { environmentId } = input;

  return {
    environmentId,
    mint() {
      const code = randomCode();
      const expiresAt = now() + PAIRING_CODE_TTL_MS;
      pending.set(code, expiresAt);
      return { code, expiresAt };
    },
    exchange(code) {
      const key = normalizePairingCode(code);
      const expiresAt = pending.get(key);
      if (expiresAt === undefined) return null;
      pending.delete(key);
      if (expiresAt <= now()) return null;
      const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");
      sessions.add(token);
      return { token, environmentId };
    },
    accepts(token) {
      return token !== null && sessions.has(token);
    },
  };
}
