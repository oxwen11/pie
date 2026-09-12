import type { StoredPairingSession } from "./pairing-session";

export type PairingMode = "open" | "required";

export type PairingAccess =
  | { readonly kind: "open" }
  | { readonly kind: "session"; readonly session: StoredPairingSession }
  | { readonly kind: "pair" };

export function resolvePairingAccess(
  mode: PairingMode,
  stored: StoredPairingSession | null,
): PairingAccess {
  if (mode === "open") return { kind: "open" };
  if (stored !== null) return { kind: "session", session: stored };
  return { kind: "pair" };
}

/**
 * GET /api/environment answers without a pairing side effect: 200 is
 * unauthenticated `pie serve`, 401 means the daemon has a token.
 */
export async function probePairingMode(fetchImpl: typeof fetch = fetch): Promise<PairingMode> {
  try {
    const response = await fetchImpl("/api/environment");
    return response.status === 200 ? "open" : "required";
  } catch {
    return "open";
  }
}
