import { playwright } from "@vitest/browser-playwright";

/** Pre-bundle React so Vite does not reload mid-test after first optimize. */
export const pieBrowserOptimizeDeps = {
  include: [
    "react",
    "react/jsx-dev-runtime",
    "react-dom",
    "react-dom/client",
    "vitest-browser-react",
  ],
};

/** Shared Chromium provider for package UI tests and app e2e. */
export function pieBrowser(options?: { viewport?: { width: number; height: number } }) {
  return {
    enabled: true,
    headless: true,
    ui: false,
    screenshot: { failures: true } as const,
    ...(options?.viewport === undefined ? undefined : { viewport: options.viewport }),
    provider: playwright({
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    }),
    instances: [{ browser: "chromium" as const }],
  };
}
