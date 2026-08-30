import { use, type ReactElement, type ReactNode } from "react";

import "./index.css";

import type { BrowserAccessResult } from "./browser-access";

export type BrowserAccessProps = {
  readonly access: Promise<BrowserAccessResult>;
  readonly children: ReactNode;
};

function AccessMessage({ failed }: { readonly failed: boolean }): ReactElement {
  return (
    <main className="bg-background text-foreground flex min-h-svh items-center justify-center p-6">
      <section className="bg-card w-full max-w-md rounded-xl border p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Pairing required</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {failed
            ? "This pairing link has expired or was already used. Request a new pairing link from Pie Desktop or the Pie CLI."
            : "Open a fresh pairing link from Pie Desktop or run pie open to use Pie in this browser."}
        </p>
      </section>
    </main>
  );
}

/** Browser-only auth gate; Desktop keeps its separate composition root. */
export function BrowserAccess({ access, children }: BrowserAccessProps): ReactNode {
  const result = use(access);
  return result.status === "authenticated" ? (
    children
  ) : (
    <AccessMessage failed={result.status === "pairing-failed"} />
  );
}

export function BrowserAccessFallback(): ReactElement {
  return (
    <main className="bg-background text-foreground flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Connecting to Pie…</p>
    </main>
  );
}
