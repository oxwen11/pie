import { AppInterface, type ServerConnection, type ServerStatusFeed } from "@getpie/app";
import { use, useEffect, useState, type ReactElement } from "react";

import { startupAnimation } from "./startup-animation";

function sameConnection(a: ServerConnection, b: ServerConnection): boolean {
  return a.httpBaseUrl === b.httpBaseUrl && a.wsBaseUrl === b.wsBaseUrl && a.token === b.token;
}

export function ReadyApp({
  server,
  refresh,
  status,
  onReady,
}: {
  server: Promise<ServerConnection>;
  refresh: () => Promise<ServerConnection>;
  status: ServerStatusFeed;
  onReady: () => void;
}): ReactElement {
  use(server);
  return <KeyedApp load={refresh} status={status} onReady={onReady} />;
}

function KeyedApp({
  load,
  status,
  onReady,
}: {
  load: () => Promise<ServerConnection>;
  status: ServerStatusFeed;
  onReady: () => void;
}): ReactElement {
  // One promise per mount. A new promise every render would re-suspend `use`.
  const [promise] = useState(() => load());
  const initial = use(promise);
  const [connection, setConnection] = useState(initial);

  // The daemon mints a fresh token on every respawn, so the startup connection
  // dies with the first server restart. The feed only emits transitions, so
  // every "ready" it delivers means a restart just completed — re-fetch then,
  // keeping the old object identity when nothing actually changed.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = status.subscribe((next) => {
      if (next !== "ready") return;
      void load()
        .then((fresh) => {
          if (cancelled) return;
          setConnection((current) => (sameConnection(current, fresh) ? current : fresh));
        })
        .catch((error: unknown) => {
          console.error("Failed to refresh the server connection", error);
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [status, load]);

  use(startupAnimation);
  useEffect(onReady, [onReady]);
  return <AppInterface server={connection} />;
}
