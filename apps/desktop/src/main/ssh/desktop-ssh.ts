import path from "node:path";

import {
  connectSshEnvironment,
  discoverSshHosts,
  environmentLabel,
  probeSshClient,
  remoteStateKey,
  resolveSshInput,
  SshClientMissingError,
  sshCommandForPlatform,
  SshInvalidTargetError,
  type DiscoveredSshHost,
  type SshClientAvailability,
  type SshConnectedEnvironment,
  type SshEnvironmentError,
  type SshHostDiscoveryError,
  type SshTarget,
} from "@getpie/ssh";
import { Context, Effect, FileSystem, Layer, Ref, type PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { DesktopConfig } from "../desktop-config";

export { environmentLabel, formatSshInput } from "@getpie/ssh";
export type { SshClientAvailability, SshEnvironmentError, SshTarget } from "@getpie/ssh";

const SAVED_ENVIRONMENTS_FILE = "ssh-environments.json";
const SAVED_FILE_MODE = 0o600;

export type SavedSshEnvironment = {
  readonly id: string;
  readonly target: SshTarget;
};

export type DesktopSshConnectResult = {
  readonly id: string;
  readonly target: SshTarget;
  readonly connection: {
    readonly httpBaseUrl: string;
    readonly wsBaseUrl: string;
    readonly token: string;
  };
};

type LiveSshSession = {
  readonly id: string;
  readonly target: SshTarget;
  readonly connected: SshConnectedEnvironment;
};

type SavedFile = {
  readonly version: 1;
  readonly environments: ReadonlyArray<{
    readonly id: string;
    readonly alias: string;
    readonly hostname: string;
    readonly username: string | null;
    readonly port: number | null;
  }>;
};

export type DesktopSshShape = {
  readonly client: SshClientAvailability;
  readonly listSaved: Effect.Effect<readonly SavedSshEnvironment[]>;
  readonly connect: (raw: string) => Effect.Effect<DesktopSshConnectResult, SshEnvironmentError>;
  readonly disconnect: (id: string) => Effect.Effect<void>;
  readonly disconnectAll: Effect.Effect<void>;
  readonly remove: (id: string) => Effect.Effect<void>;
  readonly discoverHosts: Effect.Effect<readonly DiscoveredSshHost[], SshHostDiscoveryError>;
};

export class DesktopSsh extends Context.Service<DesktopSsh, DesktopSshShape>()(
  "desktop/DesktopSsh",
) {}

/** Test double: no saved hosts, and connect fails until the caller overrides it. */
export function disabledDesktopSsh(overrides?: Partial<DesktopSshShape>): DesktopSsh["Service"] {
  return DesktopSsh.of({
    client: { available: true },
    listSaved: Effect.succeed([]),
    connect: () => Effect.fail(new SshInvalidTargetError({ message: "SSH is disabled." })),
    disconnect: () => Effect.void,
    disconnectAll: Effect.void,
    remove: () => Effect.void,
    discoverHosts: Effect.succeed([]),
    ...overrides,
  });
}

function savedFilePath(userDataPath: string): string {
  return path.join(userDataPath, SAVED_ENVIRONMENTS_FILE);
}

function parseSavedFile(raw: string): readonly SavedSshEnvironment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const record = parsed as { version?: unknown; environments?: unknown };
    if (record.version !== 1 || !Array.isArray(record.environments)) return [];
    const environments: SavedSshEnvironment[] = [];
    for (const entry of record.environments) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as {
        id?: unknown;
        alias?: unknown;
        hostname?: unknown;
        username?: unknown;
        port?: unknown;
      };
      if (typeof item.id !== "string" || item.id.length === 0) continue;
      if (typeof item.alias !== "string" || item.alias.length === 0) continue;
      if (typeof item.hostname !== "string" || item.hostname.length === 0) continue;
      if (item.username !== null && typeof item.username !== "string") continue;
      if (item.port !== null && (typeof item.port !== "number" || !Number.isInteger(item.port))) {
        continue;
      }
      environments.push({
        id: item.id,
        target: {
          alias: item.alias,
          hostname: item.hostname,
          username: item.username,
          port: item.port,
        },
      });
    }
    return environments;
  } catch {
    return [];
  }
}

function serializeSavedFile(environments: readonly SavedSshEnvironment[]): string {
  const file: SavedFile = {
    version: 1,
    environments: environments.map((entry) => ({
      id: entry.id,
      alias: entry.target.alias,
      hostname: entry.target.hostname,
      username: entry.target.username,
      port: entry.target.port,
    })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const readSaved = (
  filePath: string,
): Effect.Effect<readonly SavedSshEnvironment[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    return raw.length === 0 ? [] : parseSavedFile(raw);
  });

const writeSaved = (
  filePath: string,
  environments: readonly SavedSshEnvironment[],
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, serializeSavedFile(environments));
    yield* fs.chmod(filePath, SAVED_FILE_MODE);
  });

export function makeDesktopSsh(input: {
  readonly userDataPath: string;
}): Effect.Effect<
  DesktopSsh["Service"],
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const platform = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const filePath = savedFilePath(input.userDataPath);
    const liveRef = yield* Ref.make<LiveSshSession | undefined>(undefined);
    const client = yield* probeSshClient();

    const persist = (environments: readonly SavedSshEnvironment[]) =>
      writeSaved(filePath, environments).pipe(Effect.provide(platform), Effect.ignore);

    const disconnectLive = (id: string | undefined) =>
      Effect.gen(function* () {
        const live = yield* Ref.get(liveRef);
        if (!live || (id !== undefined && live.id !== id)) return;
        yield* live.connected.close;
        yield* Ref.set(liveRef, undefined);
      });

    return DesktopSsh.of({
      client,
      listSaved: readSaved(filePath).pipe(Effect.provide(platform)),
      connect: (raw) =>
        Effect.gen(function* () {
          if (!client.available) {
            return yield* new SshClientMissingError({
              command: sshCommandForPlatform(),
              message: client.message,
            });
          }
          const target = yield* resolveSshInput(raw);
          const id = remoteStateKey(target);
          const current = yield* Ref.get(liveRef);
          if (current?.id === id) {
            return {
              id,
              target: current.target,
              connection: {
                httpBaseUrl: current.connected.httpBaseUrl,
                wsBaseUrl: current.connected.wsBaseUrl,
                token: current.connected.token,
              },
            } satisfies DesktopSshConnectResult;
          }

          const connected = yield* connectSshEnvironment(target);
          if (current) yield* current.connected.close;
          yield* Ref.set(liveRef, { id, target, connected });

          const saved = yield* readSaved(filePath);
          const next = [...saved.filter((entry) => entry.id !== id), { id, target }];
          yield* persist(next);

          yield* Effect.log("ssh.environment.connected").pipe(
            Effect.annotateLogs({
              id,
              alias: target.alias,
              hostname: target.hostname,
              label: environmentLabel(target),
            }),
          );

          return {
            id,
            target,
            connection: {
              httpBaseUrl: connected.httpBaseUrl,
              wsBaseUrl: connected.wsBaseUrl,
              token: connected.token,
            },
          } satisfies DesktopSshConnectResult;
        }).pipe(Effect.provide(platform)),
      disconnect: (id) => disconnectLive(id),
      disconnectAll: disconnectLive(undefined),
      remove: (id) =>
        Effect.gen(function* () {
          yield* disconnectLive(id);
          const saved = yield* readSaved(filePath);
          yield* persist(saved.filter((entry) => entry.id !== id));
        }).pipe(Effect.provide(platform)),
      discoverHosts: discoverSshHosts().pipe(Effect.provide(platform)),
    });
  });
}

export const DesktopSshLive = Layer.effect(
  DesktopSsh,
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    const ssh = yield* makeDesktopSsh({ userDataPath: config.userDataPath });
    yield* Effect.addFinalizer(() => ssh.disconnectAll);
    return ssh;
  }),
);
