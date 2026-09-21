import { useEffect, useState, type ReactElement } from "react";

import { AppInterface } from "./app-interface";
import {
  readPairingMode,
  resolvePairingAccess,
  validateStoredPairingSession,
} from "./pairing-mode";
import {
  connectionFromOrigin,
  readPairingSession,
  writePairingSession,
  type StoredPairingSession,
} from "./pairing-session";

async function loadPairingAccess(): Promise<{
  readonly mode: Awaited<ReturnType<typeof readPairingMode>>;
  readonly session: StoredPairingSession | null;
}> {
  const [mode, session] = await Promise.all([
    readPairingMode(),
    validateStoredPairingSession(readPairingSession()),
  ]);
  return { mode, session };
}

export function PairingGate(): ReactElement | null {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadPairingAccess>> | null>(null);
  const [session, setSession] = useState<StoredPairingSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadPairingAccess();
      if (!cancelled) setLoaded(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loaded === null) return null;
  const access = resolvePairingAccess(loaded.mode, session ?? loaded.session);

  if (access.kind === "open") {
    return <AppInterface />;
  }
  if (access.kind === "session") {
    return (
      <AppInterface
        server={connectionFromOrigin(access.session.token)}
        environmentId={access.session.environmentId}
      />
    );
  }
  return <PairingForm onPaired={setSession} />;
}

function PairingForm({
  onPaired,
}: {
  onPaired: (session: StoredPairingSession) => void;
}): ReactElement {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/pairing/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "That pairing code is invalid or expired."
              : "Pairing failed.",
          );
        }
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("token" in body) ||
          !("environmentId" in body) ||
          typeof body.token !== "string" ||
          typeof body.environmentId !== "string"
        ) {
          throw new TypeError("Pairing failed.");
        }
        const next = { token: body.token, environmentId: body.environmentId };
        writePairingSession(next);
        onPaired(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Pairing failed.");
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <main className="bg-background text-foreground flex min-h-svh items-center justify-center p-6">
      <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={onSubmit}>
        <h1 className="text-lg font-medium">Pair this browser</h1>
        <p className="text-muted-foreground text-sm">
          Enter the code from <code>pie pairing mint</code> on the daemon. This browser never stores
          the daemon token.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Pairing code</span>
          <input
            autoComplete="one-time-code"
            className="border-input bg-background rounded-md border px-3 py-2"
            disabled={pending}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            placeholder="e.g. 7K2M-9Q"
            value={code}
          />
        </label>
        {error !== null ? <p className="text-destructive text-sm">{error}</p> : null}
        <button
          className="bg-primary text-primary-foreground rounded-md px-3 py-2 disabled:opacity-50"
          disabled={pending || code.trim().length === 0}
          type="submit"
        >
          Pair
        </button>
      </form>
    </main>
  );
}
