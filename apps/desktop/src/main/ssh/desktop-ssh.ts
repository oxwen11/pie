import path from "node:path";

import { resolvePieHome, sshEnvironmentsFile } from "@getpie/server/daemon";
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
import { Context, Effect, FileSystem, Layer, Ref, Semaphore, type PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { LoginShellEnvironment } from "../server/login-shell-environment";

export { environmentLabel, formatSshInput, SshHostDiscoveryError } from "@getpie/ssh";
export type {
  DiscoveredSshHost,
  SshClientAvailability,
  SshEnvironmentError,
  SshTarget,
} from "@getpie/ssh";

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
  /** Completes when the live local forward ends. */
  readonly closed: Effect.Effect<void>;
};

type LiveSshSession = {
  readonly id: string;
  readonly target: SshTarget;
  readonly connected: SshConnectedEnvironment;
};

type SavedFileData = {
  readonly environments: ReadonlyArray<{
    readonly id: string;
    readonly alias: string;
    readonly hostname: string;
    readonly username: string | null;
    readonly port: number | null;
  }>;
};

type SavedFile = {
  readonly version: 1;
  readonly data: SavedFileData;
};

type SavedState = {
  readonly environments: readonly SavedSshEnvironment[];
};

export type DesktopSshShape = {
  readonly client: SshClientAvailability;
  readonly listSaved: Effect.Effect<readonly SavedSshEnvironment[]>;
  readonly connect: (raw: string) => Effect.Effect<DesktopSshConnectResult, SshEnvironmentError>;
  readonly disconnect: Effect.Effect<void>;
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
    disconnect: Effect.void,
    remove: () => Effect.void,
    discoverHosts: Effect.succeed([]),
    ...overrides,
  });
}

function parseEnvironments(value: unknown): SavedSshEnvironment[] {
  if (!Array.isArray(value)) return [];
  const environments: SavedSshEnvironment[] = [];
  for (const entry of value) {
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
}

function parseSavedData(value: unknown): SavedState {
  if (typeof value !== "object" || value === null) {
    return { environments: [] };
  }
  const record = value as { environments?: unknown };
  return { environments: parseEnvironments(record.environments) };
}

function parseSavedFile(raw: string): SavedState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { environments: [] };
    }
    const record = parsed as { version?: unknown; data?: unknown; environments?: unknown };
    if (record.version !== 1) {
      return { environments: [] };
    }
    if ("data" in record) return parseSavedData(record.data);
    return parseSavedData(record);
  } catch {
    return { environments: [] };
  }
}

function serializeSavedFile(state: SavedState): string {
  const file: SavedFile = {
    version: 1,
    data: {
      environments: state.environments.map((entry) => ({
        id: entry.id,
        alias: entry.target.alias,
        hostname: entry.target.hostname,
        username: entry.target.username,
        port: entry.target.port,
      })),
    },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const readSaved = (filePath: string): Effect.Effect<SavedState, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    return raw.length === 0 ? { environments: [] } : parseSavedFile(raw);
  });

const writeSaved = (
  filePath: string,
  state: SavedState,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, serializeSavedFile(state));
    yield* fs.chmod(filePath, SAVED_FILE_MODE);
  });

export function makeDesktopSsh(input: {
  readonly persistPath: string;
  readonly env?: NodeJS.ProcessEnv;
}): Effect.Effect<
  DesktopSsh["Service"],
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const platform = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const filePath = input.persistPath;
    const liveRef = yield* Ref.make(new Map<string, LiveSshSession>());
    const persistGate = yield* Semaphore.make(1);
    const cli = { env: input.env };
    const client = yield* probeSshClient(cli);

    const persistEnvironments = (environments: readonly SavedSshEnvironment[]) =>
      persistGate.withPermit(
        writeSaved(filePath, { environments }).pipe(Effect.provide(platform), Effect.ignore),
      );

    const resultFromLive = (live: LiveSshSession): DesktopSshConnectResult => ({
      id: live.id,
      target: live.target,
      connection: {
        httpBaseUrl: live.connected.httpBaseUrl,
        wsBaseUrl: live.connected.wsBaseUrl,
        token: live.connected.token,
      },
      closed: live.connected.closed,
    });

    const adoptLive = (session: LiveSshSession) =>
      Effect.gen(function* () {
        yield* Ref.update(liveRef, (lives) => new Map([...lives, [session.id, session]]));
        yield* session.connected.closed.pipe(
          Effect.andThen(() =>
            Ref.update(liveRef, (lives) => {
              if (lives.get(session.id) !== session) return lives;
              const next = new Map(lives);
              next.delete(session.id);
              return next;
            }),
          ),
          Effect.forkDetach,
        );
      });

    const closeSession = (session: LiveSshSession) => session.connected.close;

    const disconnectAll = Effect.gen(function* () {
      const lives = yield* Ref.getAndSet(liveRef, new Map());
      for (const live of lives.values()) {
        yield* closeSession(live);
      }
    });

    return DesktopSsh.of({
      client,
      listSaved: readSaved(filePath).pipe(
        Effect.provide(platform),
        Effect.map((state) => state.environments),
      ),
      connect: (raw) =>
        Effect.gen(function* () {
          if (!client.available) {
            return yield* new SshClientMissingError({
              command: sshCommandForPlatform(),
              message: client.message,
            });
          }
          const target = yield* resolveSshInput(raw, cli);
          const id = remoteStateKey(target);
          const existing = yield* Ref.get(liveRef).pipe(Effect.map((lives) => lives.get(id)));
          if (existing !== undefined) {
            return resultFromLive(existing);
          }

          const connected = yield* connectSshEnvironment(target, cli);
          yield* adoptLive({ id, target, connected });

          const saved = yield* readSaved(filePath).pipe(Effect.provide(platform));
          const next = [...saved.environments.filter((entry) => entry.id !== id), { id, target }];
          yield* persistEnvironments(next);

          yield* Effect.log("ssh.environment.connected").pipe(
            Effect.annotateLogs({
              id,
              alias: target.alias,
              hostname: target.hostname,
              label: environmentLabel(target),
            }),
          );

          return resultFromLive({ id, target, connected });
        }).pipe(Effect.provide(platform)),
      disconnect: disconnectAll,
      remove: (id) =>
        Effect.gen(function* () {
          const current = yield* Ref.modify(liveRef, (lives) => {
            const live = lives.get(id);
            if (live === undefined) return [undefined, lives];
            const next = new Map(lives);
            next.delete(id);
            return [live, next];
          });
          if (current !== undefined) {
            yield* closeSession(current);
          }
          const saved = yield* readSaved(filePath).pipe(Effect.provide(platform));
          yield* persistEnvironments(saved.environments.filter((entry) => entry.id !== id));
        }).pipe(Effect.provide(platform)),
      discoverHosts: discoverSshHosts().pipe(Effect.provide(platform)),
    });
  });
}

export const DesktopSshLive = Layer.effect(
  DesktopSsh,
  Effect.gen(function* () {
    const loginShell = yield* LoginShellEnvironment;
    const ssh = yield* makeDesktopSsh({
      persistPath: sshEnvironmentsFile(resolvePieHome()),
      env: loginShell.env,
    });
    yield* Effect.addFinalizer(() => ssh.disconnect);
    return ssh;
  }),
);
