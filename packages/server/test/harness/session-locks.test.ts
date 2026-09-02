import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import type { SessionRef } from "@getpie/contract";
import { Deferred, Effect, Fiber, Ref } from "effect";

import { makeSessionMetadataLocks } from "../../src/harness/session-locks";

const refA: SessionRef = { projectId: "proj-a", sessionId: "session-a" };
const refB: SessionRef = { projectId: "proj-a", sessionId: "session-b" };

it.effect("withLock serializes concurrent effects on the same ref", () =>
  Effect.gen(function* () {
    const locks = makeSessionMetadataLocks();
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const secondStarted = yield* Ref.make(false);

    const first = locks.withLock(
      refA,
      Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
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
);

it.effect("withLock does not block a different ref", () =>
  Effect.gen(function* () {
    const locks = makeSessionMetadataLocks();
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
);

it.effect("release drops the map entry", () =>
  Effect.gen(function* () {
    const locks = makeSessionMetadataLocks();
    yield* locks.withLock(refA, Effect.void);
    assert.equal(yield* locks.size, 1);
    yield* locks.release(refA);
    assert.equal(yield* locks.size, 0);
  }),
);

it.effect("withLock after release still works", () =>
  Effect.gen(function* () {
    const locks = makeSessionMetadataLocks();
    yield* locks.withLock(refA, Effect.void);
    yield* locks.release(refA);
    assert.equal(yield* locks.size, 0);
    yield* locks.withLock(refA, Effect.void);
    assert.equal(yield* locks.size, 1);
  }),
);
