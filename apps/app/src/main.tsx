import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { PairingGate } from "./pairing-gate";
import type { Platform } from "./platform";
import { PlatformProvider } from "./platform-provider";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const platform = {} satisfies Platform;

createRoot(rootElement).render(
  <StrictMode>
    <PlatformProvider value={platform}>
      <Suspense>
        <PairingGate />
      </Suspense>
    </PlatformProvider>
  </StrictMode>,
);
