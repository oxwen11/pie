import { PlatformProvider, ServerStatusOverlay } from "@getpie/app";
import { Suspense, use, type ReactElement } from "react";

import type { DesktopHost } from "./desktop-host";
import { ReadyApp } from "./ready-app";

export function DesktopRenderer({
  host,
  onReady,
}: {
  host: Promise<DesktopHost>;
  onReady: () => void;
}): ReactElement {
  const desktop = use(host);
  return (
    <PlatformProvider value={desktop.platform}>
      <ServerStatusOverlay feed={desktop.status} />
      <Suspense fallback={null}>
        <ReadyApp ready={desktop.ready} connection={desktop.connection} onReady={onReady} />
      </Suspense>
    </PlatformProvider>
  );
}
