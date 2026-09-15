import { Button } from "@getpie/ui/components/button";
import type { ReactElement } from "react";

export function AppErrorPage({ error }: { error: unknown }): ReactElement {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "An unexpected error occurred.";

  return (
    <main
      className="bg-background grid min-h-svh place-items-center p-8"
      data-slot="app-error-page"
    >
      <div className="max-w-lg text-center">
        <h1 className="text-xl font-medium">Pie ran into a problem</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{message}</p>
        <Button className="mt-4" onClick={() => globalThis.location.reload()}>
          Reload
        </Button>
      </div>
    </main>
  );
}
