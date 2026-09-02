import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import type { SessionRef } from "@getpie/contract";
import { Deferred, Effect, Fiber, Ref } from "effect";

import { SessionMetadataLocks, SessionMetadataLocksLayer } from "../../src/harness/session-locks";

const refA: SessionRef = { projectId: "proj-a", sessionId: "session-a" };
const refB: SessionRef = { projectId: "proj-a", sessionId: "session-b" };

const withLocks = <A, E>(effect: Effect.Effect<A, E, SessionMetadataLocks>) =>
  effect.pipe(Effect.provide(SessionMetadataLocksLayer));

it.effect("withLock serializes concurrent effects on the same ref", () =>
  withLocks(
    Effect.gen(function* () {
      const locks = yield* SessionMetadataLocks;
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondStarted = yield* Ref.make(false);

      const first = locks.withLock(
        refA,
        Deferred.succeed(firstEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseFirst)),
        ),
      );
      const second = locks.withLock(refA, Ref.set(secondStarted, true));

      const firstFiber = yield* Effect.forkChild(first);
      yield* Deferred.await(firstEntered);
      const secondFiber = yield* Effect.forkChild(second);
      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(secondStarted), false);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(firstFiber);
      yield* Fiber.join(secondFiber);
      assert.equal(yield* Ref.get(secondStarted), true);
    }),
  ),
);

it.effect("withLock does not block a different ref", () =>
  withLocks(
    Effect.gen(function* () {
      const locks = yield* SessionMetadataLocks;
      const aEntered = yield* Deferred.make<void>();
      const bEntered = yield* Deferred.make<void>();
      const releaseBoth = yield* Deferred.make<void>();

      const hold = (ref: SessionRef, entered: Deferred.Deferred<void>) =>
        locks.withLock(
          ref,
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(releaseBoth))),
        );

      const fiberA = yield* Effect.forkChild(hold(refA, aEntered));
      const fiberB = yield* Effect.forkChild(hold(refB, bEntered));
      yield* Deferred.await(aEntered);
      yield* Deferred.await(bEntered);
      yield* Deferred.succeed(releaseBoth, undefined);
      yield* Fiber.join(fiberA);
      yield* Fiber.join(fiberB);
    }),
  ),
);

it.effect("release drops the map entry", () =>
  withLocks(
    Effect.gen(function* () {
      const locks = yield* SessionMetadataLocks;
      yield* locks.withLock(refA, Effect.void);
      assert.equal(yield* locks.size, 1);
      yield* locks.release(refA);
      assert.equal(yield* locks.size, 0);
    }),
  ),
);

it.effect("withLock after release still works", () =>
  withLocks(
    Effect.gen(function* () {
      const locks = yield* SessionMetadataLocks;
      yield* locks.withLock(refA, Effect.void);
      yield* locks.release(refA);
      assert.equal(yield* locks.size, 0);
      yield* locks.withLock(refA, Effect.void);
      assert.equal(yield* locks.size, 1);
    }),
  ),
);

it.effect("concurrent first withLock on a ref share one semaphore", () =>
  withLocks(
    Effect.gen(function* () {
      const locks = yield* SessionMetadataLocks;
      const entered = yield* Ref.make(0);
      const firstEntered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const hold = locks.withLock(
        refA,
        Ref.update(entered, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(firstEntered, undefined)),
          Effect.andThen(Deferred.await(release)),
        ),
      );

      const first = yield* Effect.forkChild(hold);
      const second = yield* Effect.forkChild(hold);
      yield* Deferred.await(firstEntered);
      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(entered), 1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.equal(yield* Ref.get(entered), 2);
    }),
  ),
);
