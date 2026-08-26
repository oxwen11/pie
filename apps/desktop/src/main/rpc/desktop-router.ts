import type { WithEffectContext } from "@orpc/experimental-effect";
import { ORPCError, streamToAsyncIteratorObject } from "@orpc/server";
import { Effect, Stream } from "effect";

import { desktopContract } from "../../shared/desktop-rpc";
import type { DesktopApplication } from "../application/desktop-application";
import { implement } from "./orpc";

export type DesktopRpcContext = WithEffectContext<never>;

function rpcUserError(error: { readonly message: string }): ORPCError<"BAD_REQUEST", undefined> {
  return new ORPCError("BAD_REQUEST", { message: error.message });
}

export function makeDesktopRouter(application: DesktopApplication["Service"]) {
  const orpc = implement(desktopContract).$context<DesktopRpcContext>();

  return orpc.router({
    bootstrap: orpc.bootstrap.effect(function* () {
      return yield* application.bootstrap;
    }),
    status: {
      subscribe: orpc.status.subscribe.effect(function* ({ input }) {
        return yield* Effect.sync(() =>
          streamToAsyncIteratorObject(
            Stream.toReadableStream(application.watchServerStatus(input.after)),
          ),
        );
      }),
    },
    server: {
      connection: orpc.server.connection.effect(function* () {
        return yield* application.serverConnection;
      }),
      retry: orpc.server.retry.effect(function* () {
        yield* application.retryServer;
      }),
    },
    environments: {
      snapshot: orpc.environments.snapshot.effect(function* () {
        return yield* application.environmentSnapshot;
      }),
      subscribe: orpc.environments.subscribe.effect(function* ({ input }) {
        return yield* Effect.sync(() =>
          streamToAsyncIteratorObject(
            Stream.toReadableStream(application.watchEnvironments(input.after)),
          ),
        );
      }),
      discoverSshHosts: orpc.environments.discoverSshHosts.effect(function* () {
        const hosts = yield* application.discoverSshHosts.pipe(Effect.mapError(rpcUserError));
        // oRPC's contract is mutable T[]; ssh config discovery returns readonly.
        return [...hosts];
      }),
      connectSsh: orpc.environments.connectSsh.effect(function* ({ input }) {
        yield* application.connectSsh(input.target).pipe(Effect.mapError(rpcUserError));
      }),
      disconnectSsh: orpc.environments.disconnectSsh.effect(function* () {
        yield* application.disconnectSsh;
      }),
      removeSsh: orpc.environments.removeSsh.effect(function* ({ input }) {
        yield* application.removeSsh(input.id);
      }),
    },
    tailscale: {
      snapshot: orpc.tailscale.snapshot.effect(function* () {
        return yield* application.tailscaleSnapshot;
      }),
      enableServe: orpc.tailscale.enableServe.effect(function* () {
        yield* application.enableTailscaleServe.pipe(Effect.mapError(rpcUserError));
      }),
      disableServe: orpc.tailscale.disableServe.effect(function* () {
        yield* application.disableTailscaleServe.pipe(Effect.mapError(rpcUserError));
      }),
    },
    app: {
      quit: orpc.app.quit.effect(function* () {
        yield* application.quit;
      }),
    },
  });
}

export type DesktopRouter = ReturnType<typeof makeDesktopRouter>;
