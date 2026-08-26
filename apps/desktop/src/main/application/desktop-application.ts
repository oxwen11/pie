import { Context, Effect, Ref, Stream, SubscriptionRef } from "effect";

import type {
  DesktopBootstrap,
  DesktopOs,
  EnvironmentSnapshot,
  SshRemoteEnvironment,
  ServerConnection,
  ServerStatusSnapshot,
} from "../../shared/desktop-rpc";
import { LOCAL_ENVIRONMENT_ID } from "../../shared/desktop-rpc";
import type { LocalServer } from "../server/local-server";
import {
  environmentLabel,
  formatSshInput,
  type DesktopSsh,
  type DesktopSshConnectResult,
  type SavedSshEnvironment,
  type SshEnvironmentError,
} from "../ssh/desktop-ssh";

/** `process.platform` is Node's vocabulary; the renderer speaks `DesktopOs`. */
function currentOs(): DesktopOs {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

type ActiveConnection =
  | { readonly kind: "local" }
  | { readonly kind: "ssh"; readonly id: string; readonly connection: ServerConnection };

export class DesktopApplication extends Context.Service<
  DesktopApplication,
  {
    readonly bootstrap: Effect.Effect<DesktopBootstrap>;
    readonly serverConnection: Effect.Effect<ServerConnection>;
    readonly watchServerStatus: (after: number) => Stream.Stream<ServerStatusSnapshot>;
    readonly retryServer: Effect.Effect<void>;
    readonly environmentSnapshot: Effect.Effect<EnvironmentSnapshot>;
    readonly watchEnvironments: (after: number) => Stream.Stream<EnvironmentSnapshot>;
    readonly connectSsh: (target: string) => Effect.Effect<void, SshEnvironmentError>;
    readonly disconnectSsh: Effect.Effect<void>;
    readonly removeSsh: (id: string) => Effect.Effect<void>;
    readonly discoverSshHosts: DesktopSsh["Service"]["discoverHosts"];
    readonly quit: Effect.Effect<void>;
  }
>()("desktop/DesktopApplication") {}

export type DesktopApplicationDependencies = {
  readonly server: LocalServer["Service"];
  readonly ssh: DesktopSsh["Service"];
  readonly initialRemotes: readonly SavedSshEnvironment[];
  readonly quit: Effect.Effect<void>;
};

function remoteFromSaved(entry: SavedSshEnvironment): SshRemoteEnvironment {
  return {
    id: entry.id,
    label: environmentLabel(entry.target),
    alias: formatSshInput(entry.target),
    status: "idle",
  };
}

function snapshotFromSaved(
  remotes: readonly SavedSshEnvironment[],
  revision = 0,
): EnvironmentSnapshot {
  return {
    revision,
    activeId: LOCAL_ENVIRONMENT_ID,
    connectingLabel: null,
    remotes: remotes.map(remoteFromSaved),
  };
}

function upsertRemote(
  remotes: readonly SshRemoteEnvironment[],
  next: SshRemoteEnvironment,
): SshRemoteEnvironment[] {
  const without = remotes.filter((remote) => remote.id !== next.id);
  return [...without, next];
}

export function makeDesktopApplication({
  server,
  ssh,
  initialRemotes,
  quit,
}: DesktopApplicationDependencies): DesktopApplication["Service"] {
  const activeRef = Effect.runSync(Ref.make<ActiveConnection>({ kind: "local" }));
  const environmentsRef = Effect.runSync(
    SubscriptionRef.make<EnvironmentSnapshot>(snapshotFromSaved(initialRemotes)),
  );

  const updateEnvironments = (
    updater: (current: EnvironmentSnapshot) => Omit<EnvironmentSnapshot, "revision">,
  ): Effect.Effect<EnvironmentSnapshot> =>
    SubscriptionRef.updateAndGet(environmentsRef, (current) => ({
      ...updater(current),
      revision: current.revision + 1,
    }));

  const selectLocal = Effect.gen(function* () {
    const active = yield* Ref.get(activeRef);
    if (active.kind === "ssh") {
      yield* ssh.disconnect(active.id);
    }
    yield* Ref.set(activeRef, { kind: "local" });
    yield* updateEnvironments((current) => ({
      activeId: LOCAL_ENVIRONMENT_ID,
      connectingLabel: null,
      remotes: current.remotes.map((remote) =>
        remote.status === "ready" ? { ...remote, status: "idle", error: undefined } : remote,
      ),
    }));
  });

  return {
    bootstrap: Effect.gen(function* () {
      const current = yield* server.snapshot;
      const environments = yield* SubscriptionRef.get(environmentsRef);
      return {
        status: current.status,
        statusRevision: current.revision,
        os: currentOs(),
        environments,
      };
    }),
    serverConnection: Effect.gen(function* () {
      const active = yield* Ref.get(activeRef);
      if (active.kind === "ssh") return active.connection;
      return yield* server.connection;
    }),
    watchServerStatus: (after) =>
      server.changes.pipe(Stream.filter((snapshot) => snapshot.revision > after)),
    retryServer: server.retry,
    environmentSnapshot: SubscriptionRef.get(environmentsRef),
    watchEnvironments: (after) =>
      SubscriptionRef.changes(environmentsRef).pipe(
        Stream.filter((snapshot) => snapshot.revision > after),
      ),
    connectSsh: (target) =>
      Effect.gen(function* () {
        const trimmed = target.trim();
        yield* updateEnvironments((current) => ({
          activeId: current.activeId,
          connectingLabel: trimmed,
          remotes: current.remotes,
        }));
        const result = yield* ssh.connect(trimmed).pipe(
          Effect.tapError(() =>
            updateEnvironments((current) => ({
              activeId: current.activeId,
              connectingLabel: null,
              remotes: current.remotes,
            })),
          ),
        );
        yield* applyConnected(activeRef, updateEnvironments, result);
      }),
    disconnectSsh: selectLocal,
    removeSsh: (id) =>
      Effect.gen(function* () {
        const active = yield* Ref.get(activeRef);
        if (active.kind === "ssh" && active.id === id) {
          yield* selectLocal;
        }
        yield* ssh.remove(id);
        yield* updateEnvironments((current) => ({
          activeId: current.activeId === id ? LOCAL_ENVIRONMENT_ID : current.activeId,
          connectingLabel: null,
          remotes: current.remotes.filter((remote) => remote.id !== id),
        }));
      }),
    discoverSshHosts: ssh.discoverHosts,
    quit,
  } satisfies DesktopApplication["Service"];
}

const applyConnected = (
  activeRef: Ref.Ref<ActiveConnection>,
  updateEnvironments: (
    updater: (current: EnvironmentSnapshot) => Omit<EnvironmentSnapshot, "revision">,
  ) => Effect.Effect<EnvironmentSnapshot>,
  result: DesktopSshConnectResult,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Ref.set(activeRef, {
      kind: "ssh",
      id: result.id,
      connection: result.connection,
    });
    yield* updateEnvironments((current) => ({
      activeId: result.id,
      connectingLabel: null,
      remotes: upsertRemote(current.remotes, {
        id: result.id,
        label: environmentLabel(result.target),
        alias: formatSshInput(result.target),
        status: "ready",
      }),
    }));
  });
