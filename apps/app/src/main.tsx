import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppInterface } from "./app-interface";
import type { Platform } from "./platform";
import { PlatformProvider } from "./platform-provider";
import { ThemeProvider } from "./theme-provider";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const platform = {} satisfies Platform;

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <PlatformProvider value={platform}>
        <AppInterface />
      </PlatformProvider>
    </ThemeProvider>
  </StrictMode>,
);
