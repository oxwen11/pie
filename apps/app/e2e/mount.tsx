import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { inject } from "vitest";

import { AppInterface } from "../src/app-interface";
import { PlatformProvider } from "../src/platform-provider";
import { ThemeProvider } from "../src/theme-provider";

import "../src/index.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

export function pieE2E() {
  return inject("pieE2E");
}

export async function mountApp(path = "/draft"): Promise<HTMLDivElement> {
  unmountApp();
  window.history.replaceState(null, "", path);
  host = document.createElement("div");
  host.style.width = "1280px";
  host.style.height = "800px";
  document.body.append(host);
  root = createRoot(host);
  const server = pieE2E();
  const tree: ReactElement = (
    <ThemeProvider>
      <PlatformProvider value={{}}>
        <AppInterface
          server={{
            httpBaseUrl: server.httpBaseUrl,
            wsBaseUrl: server.wsBaseUrl,
          }}
        />
      </PlatformProvider>
    </ThemeProvider>
  );
  await act(async () => {
    root?.render(tree);
  });
  return host;
}

export function unmountApp(): void {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
}
