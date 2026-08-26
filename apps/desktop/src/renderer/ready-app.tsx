import {
  AppInterface,
  LOCAL_ENVIRONMENT_ID,
  type EnvironmentFeed,
  type ServerConnection,
  type ServerStatusFeed,
} from "@getpie/app";
import { use, useEffect, useState, useSyncExternalStore, type ReactElement } from "react";

import { startupAnimation } from "./startup-animation";

const localEnvironmentSnapshot = {
  revision: 0,
  activeId: LOCAL_ENVIRONMENT_ID,
  connectingLabel: null,
  remotes: [],
} as const;

const subscribeNoop = (): (() => void) => () => {};
const getLocalEnvironmentSnapshot = () => localEnvironmentSnapshot;

function sameConnection(a: ServerConnection, b: ServerConnection): boolean {
  return a.httpBaseUrl === b.httpBaseUrl && a.wsBaseUrl === b.wsBaseUrl && a.token === b.token;
}

export function ReadyApp({
  server,
  refresh,
  status,
  environments,
  onReady,
}: {
  server: Promise<ServerConnection>;
  refresh: () => Promise<ServerConnection>;
  status: ServerStatusFeed;
  environments?: EnvironmentFeed;
  onReady: () => void;
}): ReactElement {
  use(server);
  const snapshot = useSyncExternalStore(
    environments?.subscribe ?? subscribeNoop,
    environments?.getSnapshot ?? getLocalEnvironmentSnapshot,
  );

  return <KeyedApp key={snapshot.activeId} load={refresh} status={status} onReady={onReady} />;
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
  const [promise] = useState(load);
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
