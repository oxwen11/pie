import { Context, Effect, Stream, SubscriptionRef } from "effect";

import type {
  DesktopBootstrap,
  DesktopOs,
  DiscoveredSshHost,
  EnvironmentSnapshot,
  ServerConnection,
  ServerStatusSnapshot,
  SshRemoteEnvironment,
  TailscaleSnapshot,
} from "../../shared/desktop-rpc";
import type { LocalServer } from "../server/local-server";
import {
  environmentLabel,
  formatSshInput,
  type DesktopSsh,
  type SshEnvironmentError,
} from "../ssh/desktop-ssh";
import {
  portFromHttpBaseUrl,
  TailscaleCommandError,
  type DesktopTailscale,
  type TailscaleEnvironmentError,
} from "../tailscale/desktop-tailscale";
import { mergeDiscoveredHosts } from "../tailscale/merge-discovered-hosts";

/** `process.platform` is Node's vocabulary; the renderer speaks `DesktopOs`. */
function currentOs(): DesktopOs {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

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
    readonly removeSsh: (id: string) => Effect.Effect<void>;
    readonly discoverSshHosts: Effect.Effect<readonly DiscoveredSshHost[]>;
    readonly tailscaleSnapshot: Effect.Effect<TailscaleSnapshot>;
    readonly enableTailscaleServe: Effect.Effect<void, TailscaleEnvironmentError>;
    readonly disableTailscaleServe: Effect.Effect<void, TailscaleEnvironmentError>;
    readonly quit: Effect.Effect<void>;
  }
>()("desktop/DesktopApplication") {}

export type DesktopApplicationDependencies = {
  readonly server: LocalServer["Service"];
  readonly ssh: DesktopSsh["Service"];
  readonly tailscale: DesktopTailscale["Service"];
  readonly quit: Effect.Effect<void>;
};

async function fetchEnvironmentId(connection: ServerConnection): Promise<string | undefined> {
  try {
    const response = await fetch(`${connection.httpBaseUrl}/api/environment`, {
      headers: { authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id.length > 0 ? body.id : undefined;
  } catch {
    return undefined;
  }
}

function emptySnapshot(): EnvironmentSnapshot {
  return {
    revision: 0,
    connectingLabel: null,
    remotes: [],
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
  tailscale,
  quit,
}: DesktopApplicationDependencies): DesktopApplication["Service"] {
  const environmentsRef = Effect.runSync(
    SubscriptionRef.make<EnvironmentSnapshot>(emptySnapshot()),
  );

  const updateEnvironments = (
    updater: (current: EnvironmentSnapshot) => Omit<EnvironmentSnapshot, "revision">,
  ): Effect.Effect<EnvironmentSnapshot> =>
    SubscriptionRef.updateAndGet(environmentsRef, (current) => ({
      ...updater(current),
      revision: current.revision + 1,
    }));

  const connectSsh = (target: string) =>
    Effect.gen(function* () {
      const trimmed = target.trim();
      yield* updateEnvironments((current) => ({
        connectingLabel: trimmed,
        remotes: current.remotes,
      }));
      const result = yield* ssh.connect(trimmed).pipe(
        Effect.tapError(() =>
          updateEnvironments((current) => ({
            connectingLabel: null,
            remotes: current.remotes,
          })),
        ),
      );
      const environmentId = yield* Effect.promise(() =>
        fetchEnvironmentId(result.connection).then((id) => id ?? result.id),
      );
      yield* updateEnvironments((current) => ({
        connectingLabel: null,
        remotes: upsertRemote(current.remotes, {
          id: result.id,
          environmentId,
          label: environmentLabel(result.target),
          alias: formatSshInput(result.target),
          connection: result.connection,
        }),
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
        sshClient: ssh.client,
        tailscaleClient: tailscale.client,
        environments,
      };
    }),
    serverConnection: server.connection,
    watchServerStatus: (after) =>
      server.changes.pipe(Stream.filter((snapshot) => snapshot.revision > after)),
    retryServer: server.retry,
    environmentSnapshot: SubscriptionRef.get(environmentsRef),
    watchEnvironments: (after) =>
      SubscriptionRef.changes(environmentsRef).pipe(
        Stream.filter((snapshot) => snapshot.revision > after),
      ),
    connectSsh,
    removeSsh: (id) =>
      Effect.gen(function* () {
        yield* ssh.remove(id);
        yield* updateEnvironments((current) => ({
          connectingLabel: null,
          remotes: current.remotes.filter((remote) => remote.id !== id),
        }));
      }),
    discoverSshHosts: Effect.gen(function* () {
      const [sshHosts, tailscaleHosts] = yield* Effect.all(
        [ssh.discoverHosts.pipe(Effect.orElseSucceed(() => [])), tailscale.listSshHosts],
        { concurrency: 2 },
      );
      return mergeDiscoveredHosts(sshHosts, tailscaleHosts);
    }),
    tailscaleSnapshot: tailscale.snapshot,
    enableTailscaleServe: Effect.gen(function* () {
      const connection = yield* server.connection;
      const localPort = portFromHttpBaseUrl(connection.httpBaseUrl);
      if (localPort === null) {
        return yield* new TailscaleCommandError({
          command: ["tailscale", "serve"],
          exitCode: null,
          message: "The local pie daemon has no port to share over Tailscale.",
        });
      }
      yield* tailscale.enableServe(localPort);
    }),
    disableTailscaleServe: tailscale.disableServe,
    quit,
  } satisfies DesktopApplication["Service"];
}
