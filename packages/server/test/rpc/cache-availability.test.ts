import assert from "node:assert/strict";

import { describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { cachePiAgentAvailability } from "../../src/harness/pi/agent";

describe("cachePiAgentAvailability", () => {
  it.effect("a caller interrupted mid-check does not poison the cache", () =>
    Effect.gen(function* () {
      // `Effect.cached` stores whatever exit the first caller's fiber
      // observes — forever. Without the uninterruptible guard, a client
      // disconnect during the first check stores the interruption and every
      // later call replays it as a defect until process restart.
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      let runs = 0;
      const cached = yield* cachePiAgentAvailability(
        Effect.suspend(() => {
          runs += 1;
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.as({ available: true as const }),
          );
        }),
      );

      const caller = yield* Effect.forkChild(cached);
      yield* Deferred.await(started);
      // Interrupt while the check is in flight; the guard makes the fiber
      // ride out the interruption, so awaiting it needs the gate open.
      const interruptor = yield* Effect.forkChild(Fiber.interrupt(caller));
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.await(interruptor);

      const result = yield* cached;
      assert.deepEqual(result, { available: true });
      // The healthy exit came from the cache, not a rerun.
      assert.equal(runs, 1);
    }),
  );
});
