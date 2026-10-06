import { makeJsonDocument } from "@getpie/effect-json-store";
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
  SshReadinessError,
  type DiscoveredSshHost,
  type SshClientAvailability,
  type SshConnectedEnvironment,
  type SshEnvironmentError,
  type SshHostDiscoveryError,
  type SshTarget,
} from "@getpie/ssh";
import { Context, Data, Effect, FileSystem, Layer, Ref, Schema, Scope, Semaphore } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { LoginShellEnvironment } from "../server/login-shell-environment";

export {
  environmentLabel,
  formatSshInput,
  SshHostDiscoveryError,
  SshReadinessError,
} from "@getpie/ssh";
export type {
  DiscoveredSshHost,
  SshClientAvailability,
  SshEnvironmentError,
  SshTarget,
} from "@getpie/ssh";

const SAVED_FILE_MODE = 0o600;
const ENVIRONMENT_ID_TIMEOUT_MS = 8_000;

export class SshPersistError extends Data.TaggedError("SshPersistError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SavedSshEnvironment = {
  readonly id: string;
  readonly target: SshTarget;
};

export type DesktopSshConnectResult = {
  readonly id: string;
  readonly target: SshTarget;
  readonly environmentId: string;
  readonly connection: {
    readonly httpBaseUrl: string;
    readonly wsBaseUrl: string;
    readonly token: string;
  };
  readonly reportedHostname?: string;
  /** Completes when the live local forward ends. */
  readonly closed: Effect.Effect<void>;
};

type LiveSshSession = {
  readonly id: string;
  readonly target: SshTarget;
  readonly environmentId: string;
  readonly connected: SshConnectedEnvironment;
};

type SshConnection = DesktopSshConnectResult["connection"];

export type DesktopSshShape = {
  readonly client: SshClientAvailability;
  readonly listSaved: Effect.Effect<readonly SavedSshEnvironment[]>;
  readonly connect: (
    raw: string,
  ) => Effect.Effect<DesktopSshConnectResult, SshEnvironmentError | SshPersistError>;
  readonly disconnect: Effect.Effect<void>;
  readonly remove: (id: string) => Effect.Effect<void, SshPersistError>;
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

function parseEnvironmentId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

const fetchEnvironmentId = (connection: SshConnection): Effect.Effect<string, SshReadinessError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${connection.httpBaseUrl}/api/environment`, {
          headers: { authorization: `Bearer ${connection.token}` },
          signal: AbortSignal.timeout(ENVIRONMENT_ID_TIMEOUT_MS),
        });
        if (!response.ok) return undefined;
        return parseEnvironmentId(await response.json());
      },
      catch: (cause) =>
        new SshReadinessError({
          message: `Remote pie daemon did not advertise an environment id at ${connection.httpBaseUrl}/api/environment.`,
          cause,
        }),
    });
    if (result !== undefined) return result;
    return yield* new SshReadinessError({
      message: `Remote pie daemon did not advertise an environment id at ${connection.httpBaseUrl}/api/environment.`,
    });
  });

const SavedEnvironmentRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  alias: Schema.NonEmptyString,
  hostname: Schema.NonEmptyString,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Int),
});
const SavedEnvironmentsSchema = Schema.Struct({
  environments: Schema.Array(SavedEnvironmentRecord),
});

const toSaved = (record: typeof SavedEnvironmentRecord.Type): SavedSshEnvironment => ({
  id: record.id,
  target: {
    alias: record.alias,
    hostname: record.hostname,
    username: record.username,
    port: record.port,
  },
});

const fromSaved = (entry: SavedSshEnvironment): typeof SavedEnvironmentRecord.Type => ({
  id: entry.id,
  alias: entry.target.alias,
  hostname: entry.target.hostname,
  username: entry.target.username,
  port: entry.target.port,
});

const persistError = (filePath: string, cause: unknown) =>
  new SshPersistError({
    message: `Failed to persist SSH environments to ${filePath}.`,
    cause,
  });

export function makeDesktopSsh(input: {
  readonly persistPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveInput?: (raw: string) => Effect.Effect<SshTarget, SshEnvironmentError>;
  readonly connectEnvironment?: (
    target: SshTarget,
  ) => Effect.Effect<SshConnectedEnvironment, SshEnvironmentError>;
  readonly loadEnvironmentId?: (
    connection: SshConnection,
  ) => Effect.Effect<string, SshReadinessError>;
}): Effect.Effect<
  DesktopSsh["Service"],
  SshPersistError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const platform = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const filePath = input.persistPath;
    const fs = yield* FileSystem.FileSystem;
    const saved = yield* makeJsonDocument({
      path: filePath,
      schema: SavedEnvironmentsSchema,
      defaults: { environments: [] },
    }).pipe(Effect.mapError((cause) => persistError(filePath, cause)));
    // ponytail: library write does not take a mode; pin 0600 after open and each save.
    const pinMode = fs
      .chmod(filePath, SAVED_FILE_MODE)
      .pipe(Effect.mapError((cause) => persistError(filePath, cause)));
    yield* pinMode;
    const liveRef = yield* Ref.make(new Map<string, LiveSshSession>());
    const persistGate = yield* Semaphore.make(1);
    const cli = { env: input.env };
    const client = yield* probeSshClient(cli);
    const loadEnvironmentId = input.loadEnvironmentId ?? fetchEnvironmentId;

    const modifySaved = (
      mutate: (environments: readonly SavedSshEnvironment[]) => readonly SavedSshEnvironment[],
    ) =>
      persistGate.withPermit(
        saved
          .update((current) => ({
            environments: mutate(current.environments.map(toSaved)).map(fromSaved),
          }))
          .pipe(
            Effect.tapError(() =>
              Effect.logError("ssh.environments.persist.failed").pipe(
                Effect.annotateLogs({ path: filePath }),
              ),
            ),
            Effect.andThen(pinMode),
            Effect.mapError((cause) => persistError(filePath, cause)),
          ),
      );

    const resultFromLive = (live: LiveSshSession): DesktopSshConnectResult => ({
      id: live.id,
      target: live.target,
      environmentId: live.environmentId,
      connection: {
        httpBaseUrl: live.connected.httpBaseUrl,
        wsBaseUrl: live.connected.wsBaseUrl,
        token: live.connected.token,
      },
      reportedHostname: live.connected.reportedHostname,
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
          // The handler scope ends when connect returns. The watcher has to
          // live on the layer scope so a dead tunnel still leaves the snapshot.
          Effect.forkIn(ownerScope),
        );
      });

    const closeSession = (session: LiveSshSession) => session.connected.close;

    const disconnectAll = Effect.gen(function* () {
      const lives = yield* Ref.getAndSet(liveRef, new Map<string, LiveSshSession>());
      for (const live of lives.values()) {
        yield* closeSession(live);
      }
    });

    return DesktopSsh.of({
      client,
      listSaved: saved.get.pipe(Effect.map((state) => state.environments.map(toSaved))),
      connect: (raw) =>
        Effect.gen(function* () {
          const missingMessage = client.available ? undefined : client.message;
          if (missingMessage !== undefined && input.connectEnvironment === undefined) {
            return yield* new SshClientMissingError({
              command: sshCommandForPlatform(),
              message: missingMessage,
            });
          }
          const target = yield* input.resolveInput?.(raw) ?? resolveSshInput(raw, cli);
          const id = remoteStateKey(target);
          const existing = yield* Ref.get(liveRef).pipe(Effect.map((lives) => lives.get(id)));
          if (existing !== undefined) {
            return resultFromLive(existing);
          }

          const connected = yield* (
            input.connectEnvironment?.(target) ?? connectSshEnvironment(target, cli)
          );
          const connection = {
            httpBaseUrl: connected.httpBaseUrl,
            wsBaseUrl: connected.wsBaseUrl,
            token: connected.token,
          };
          const environmentId = yield* loadEnvironmentId(connection).pipe(
            Effect.tapError(() => connected.close),
          );
          const result = yield* persistGate
            .withPermit(
              Effect.gen(function* () {
                const lives = yield* Ref.get(liveRef);
                for (const live of lives.values()) {
                  if (live.environmentId !== environmentId) continue;
                  yield* connected.close;
                  yield* Effect.log("ssh.environment.reused").pipe(
                    Effect.annotateLogs({
                      id: live.id,
                      environmentId,
                      alias: target.alias,
                      hostname: target.hostname,
                    }),
                  );
                  return resultFromLive(live);
                }
                yield* saved
                  .update((current) => ({
                    environments: [
                      ...current.environments.filter((entry) => entry.id !== id),
                      fromSaved({ id, target }),
                    ],
                  }))
                  .pipe(
                    Effect.tapError(() =>
                      Effect.logError("ssh.environments.persist.failed").pipe(
                        Effect.annotateLogs({ path: filePath }),
                      ),
                    ),
                    Effect.andThen(pinMode),
                    Effect.mapError((cause) => persistError(filePath, cause)),
                  );
                yield* adoptLive({ id, target, environmentId, connected });
                yield* Effect.log("ssh.environment.connected").pipe(
                  Effect.annotateLogs({
                    id,
                    environmentId,
                    alias: target.alias,
                    hostname: target.hostname,
                    label: environmentLabel(target),
                  }),
                );
                return resultFromLive({ id, target, environmentId, connected });
              }).pipe(Effect.provide(platform)),
            )
            .pipe(Effect.tapError(() => connected.close));
          return result;
        }).pipe(Effect.provide(platform)),
      disconnect: disconnectAll,
      remove: (id) =>
        Effect.gen(function* () {
          yield* modifySaved((environments) => environments.filter((entry) => entry.id !== id));
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
