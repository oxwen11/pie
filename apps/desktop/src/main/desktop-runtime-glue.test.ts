import { Effect, Layer, ManagedRuntime, SubscriptionRef } from "effect";
import { describe, expect, it } from "vitest";

import type { ServerStatusSnapshot } from "../shared/desktop-rpc";
import { DesktopApplication } from "./application/desktop-application";
import { DesktopApplicationLive } from "./desktop-runtime-glue";
import { LocalServer } from "./server/local-server";
import { DesktopSsh, disabledDesktopSsh } from "./ssh/desktop-ssh";

describe("DesktopApplicationLive", () => {
  it("resolves a DesktopApplication built from a LocalServer provided through the Layer graph", async () => {
    const statusRef = Effect.runSync(
      SubscriptionRef.make<ServerStatusSnapshot>({ revision: 0, status: "ready" }),
    );

    // LocalServer and DesktopSsh are faked: this test exercises the Layer
    // wiring introduced by this module, not supervision or SSH launch.
    const fakeLocalServerLive = Layer.succeed(LocalServer, {
      connection: Effect.succeed({
        httpBaseUrl: "http://127.0.0.1:1",
        wsBaseUrl: "ws://127.0.0.1:1",
        token: "fake-token",
      }),
      snapshot: SubscriptionRef.get(statusRef),
      changes: SubscriptionRef.changes(statusRef),
      retry: Effect.void,
    });

    const fakeSshLive = Layer.succeed(DesktopSsh, disabledDesktopSsh());

    const runtime = ManagedRuntime.make(
      DesktopApplicationLive.pipe(Layer.provide(fakeLocalServerLive), Layer.provide(fakeSshLive)),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const application = yield* DesktopApplication;
          return {
            bootstrap: yield* application.bootstrap,
            server: yield* application.serverConnection,
          };
        }),
      );

      expect(result.bootstrap).toMatchObject({
        status: "ready",
        statusRevision: 0,
      });
      expect(result.server).toMatchObject({ token: "fake-token" });
    } finally {
      await runtime.dispose();
    }
  });
});
