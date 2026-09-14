import { Context, Effect, Stream, SubscriptionRef } from "effect";

import type {
  ServerConnection,
  ServerStatusSnapshot,
  DesktopBootstrap,
  DesktopOs,
} from "../../shared/desktop-rpc";
import type { LocalServer } from "../server/local-server";

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
    readonly windowVisibility: Stream.Stream<boolean>;
    readonly setWindowVisible: (visible: boolean) => Effect.Effect<void>;
    readonly retryServer: Effect.Effect<void>;
    readonly quit: Effect.Effect<void>;
  }
>()("desktop/DesktopApplication") {}

export type DesktopApplicationDependencies = {
  readonly server: LocalServer["Service"];
  readonly quit: Effect.Effect<void>;
};

export function makeDesktopApplication({
  server,
  quit,
}: DesktopApplicationDependencies): Effect.Effect<DesktopApplication["Service"]> {
  return Effect.gen(function* () {
    const visible = yield* SubscriptionRef.make(false);
    return {
      bootstrap: Effect.gen(function* () {
        const current = yield* server.snapshot;
        return {
          status: current.status,
          statusRevision: current.revision,
          os: currentOs(),
        };
      }),
      serverConnection: server.connection,
      // v4 SubscriptionRef.changes replays the latest snapshot on subscribe
      // (PubSub replay: 1), so the stream always starts from the current status.
      watchServerStatus: (after) =>
        server.changes.pipe(Stream.filter((snapshot) => snapshot.revision > after)),
      windowVisibility: SubscriptionRef.changes(visible),
      setWindowVisible: (value) => SubscriptionRef.set(visible, value),
      retryServer: server.retry,
      quit,
    } satisfies DesktopApplication["Service"];
  });
}
