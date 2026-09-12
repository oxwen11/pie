import type { StoredPairingSession } from "./pairing-session";

export type PairingMode = "open" | "required";

export type PairingAccess =
  | { readonly kind: "open" }
  | { readonly kind: "session"; readonly session: StoredPairingSession }
  | { readonly kind: "pair" };

/**
 * Pairing routes exist only when the daemon has an auth token. A 404 means
 * unauthenticated `pie serve` (Vite :4190) — the SPA must load without a gate.
 */
export function pairingModeFromStatus(status: number): PairingMode {
  return status === 404 ? "open" : "required";
}

export function resolvePairingAccess(
  mode: PairingMode,
  stored: StoredPairingSession | null,
): PairingAccess {
  if (mode === "open") return { kind: "open" };
  if (stored !== null) return { kind: "session", session: stored };
  return { kind: "pair" };
}

export async function probePairingMode(fetchImpl: typeof fetch = fetch): Promise<PairingMode> {
  try {
    const response = await fetchImpl("/api/pairing/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "probe" }),
    });
    return pairingModeFromStatus(response.status);
  } catch {
    return "open";
  }
}
