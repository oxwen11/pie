import { AppInterface, type ServerConnection, type ServerStatusFeed } from "@getpie/app";
import { use, useEffect, useRef, useState, type ReactElement } from "react";

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
  // `server` is the host's one cached promise. Never start a request during
  // render: an uncommitted mount loses its refs on every suspend, so each
  // retry would mint another request (#473).
  const initial = use(server);
  const [connection, setConnection] = useState(initial);
  const tokenHolder = useRef(initial.token ?? "");

  // The daemon mints a fresh token on every respawn, so the startup connection
  // dies with the first server restart. The feed replays transitions after the
  // bootstrap revision, so every "ready" it delivers may be a completed
  // restart — re-fetch then, keeping the old object identity when nothing
  // actually changed.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = status.subscribe((next) => {
      if (next !== "ready") return;
      void refresh()
        .then((fresh) => {
          if (!cancelled) {
            tokenHolder.current = fresh.token ?? "";
            setConnection((current) => (sameConnection(current, fresh) ? current : fresh));
          }
          return undefined;
        })
        .catch((error: unknown) => {
          console.error("Failed to refresh the server connection", error);
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [status, refresh]);

  use(startupAnimation);
  useEffect(onReady, [onReady]);
  return <AppInterface server={connection} tokenHolder={tokenHolder} />;
}
