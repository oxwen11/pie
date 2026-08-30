import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { AppInterface } from "./app-interface";
import { resolveBrowserAccess } from "./browser-access";
import { BrowserAccess, BrowserAccessFallback } from "./browser-access-gate";
import type { Platform } from "./platform";
import { PlatformProvider } from "./platform-provider";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const platform = {} satisfies Platform;
const access = resolveBrowserAccess();

createRoot(rootElement).render(
  <StrictMode>
    <PlatformProvider value={platform}>
      <Suspense fallback={<BrowserAccessFallback />}>
        <BrowserAccess access={access}>
          <AppInterface />
        </BrowserAccess>
      </Suspense>
    </PlatformProvider>
  </StrictMode>,
);
