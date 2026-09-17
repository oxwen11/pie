import { inject } from "vitest";
import { render, type RenderResult } from "vitest-browser-react";

import { AppInterface } from "../src/app-interface";
import { PlatformProvider } from "../src/platform-provider";
import { ThemeProvider } from "../src/theme-provider";

import "../src/index.css";

let screen: RenderResult | undefined;

export function pieE2E() {
  return inject("pieE2E");
}

export async function mountApp(path = "/draft"): Promise<void> {
  await unmountApp();
  window.history.replaceState(null, "", path);
  const server = pieE2E();
  screen = await render(
    <ThemeProvider>
      <PlatformProvider value={{}}>
        <AppInterface
          server={{
            httpBaseUrl: server.httpBaseUrl,
            wsBaseUrl: server.wsBaseUrl,
          }}
        />
      </PlatformProvider>
    </ThemeProvider>,
  );
}

export async function unmountApp(): Promise<void> {
  await screen?.unmount();
  screen = undefined;
}
