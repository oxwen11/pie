import type { ServerConnection } from "./server-connection";

export const PAIRING_SESSION_STORAGE_KEY = "pie.pairing.session";

export type StoredPairingSession = {
  readonly token: string;
  readonly environmentId: string;
};

export function readPairingSession(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): StoredPairingSession | null {
  if (storage === undefined) return null;
  const raw = storage.getItem(PAIRING_SESSION_STORAGE_KEY);
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as { token?: unknown; environmentId?: unknown };
    if (typeof record.token !== "string" || record.token.length === 0) return null;
    if (typeof record.environmentId !== "string" || record.environmentId.length === 0) return null;
    return { token: record.token, environmentId: record.environmentId };
  } catch {
    return null;
  }
}

export function writePairingSession(
  session: StoredPairingSession,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(PAIRING_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearPairingSession(
  storage: Pick<Storage, "removeItem"> | undefined = globalThis.localStorage,
): void {
  storage?.removeItem(PAIRING_SESSION_STORAGE_KEY);
}

export function connectionFromOrigin(
  token: string,
  origin: string = globalThis.location.origin,
): ServerConnection {
  const http = new URL(origin);
  const ws = new URL(origin);
  ws.protocol = http.protocol === "https:" ? "wss:" : "ws:";
  return {
    httpBaseUrl: http.origin,
    wsBaseUrl: ws.origin,
    token,
  };
}
