import { Effect, Layer, ManagedRuntime, SubscriptionRef } from "effect";
import { describe, expect, it } from "vitest";

import type { ServerStatusSnapshot } from "../shared/desktop-rpc";
import { DesktopApplication } from "./application/desktop-application";
import { DesktopApplicationLive } from "./desktop-runtime-glue";
import { LocalServer } from "./server/local-server";

describe("DesktopApplicationLive", () => {
  it("resolves a DesktopApplication built from a LocalServer provided through the Layer graph", async () => {
    const statusRef = Effect.runSync(
      SubscriptionRef.make<ServerStatusSnapshot>({ revision: 0, status: "ready" }),
    );

    // Only LocalServer is faked: this test exercises the Layer wiring
    // introduced by this module (LocalServer -> DesktopApplication), not
    // the already-covered supervision logic inside makeLocalServer itself.
    const fakeLocalServerLive = Layer.succeed(LocalServer, {
      ready: Effect.void,
      webSocketAccess: Effect.succeed({
        url: "ws://127.0.0.1:1/ws/rpc?ticket=one-time",
      }),
      browserPairing: Effect.succeed({
        url: "http://127.0.0.1:1/pair#grant=one-time",
      }),
      snapshot: SubscriptionRef.get(statusRef),
      changes: SubscriptionRef.changes(statusRef),
      retry: Effect.void,
    });

    const runtime = ManagedRuntime.make(
      DesktopApplicationLive.pipe(Layer.provide(fakeLocalServerLive)),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const application = yield* DesktopApplication;
          return {
            bootstrap: yield* application.bootstrap,
            server: yield* application.serverWebSocketAccess,
          };
        }),
      );

      expect(result.bootstrap).toMatchObject({
        status: "ready",
        statusRevision: 0,
      });
      expect(result.server).toEqual({
        url: "ws://127.0.0.1:1/ws/rpc?ticket=one-time",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
