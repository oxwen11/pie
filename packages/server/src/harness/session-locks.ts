import type { SessionRef } from "@getpie/contract";
import { Context, Effect, Layer, Semaphore } from "effect";

export type SessionMetadataLocksShape = {
  readonly withLock: <A, E, R>(
    ref: SessionRef,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly release: (ref: SessionRef) => Effect.Effect<void>;
  readonly size: Effect.Effect<number>;
};

export class SessionMetadataLocks extends Context.Service<
  SessionMetadataLocks,
  SessionMetadataLocksShape
>()("SessionMetadataLocks") {}

const makeSessionMetadataLocks = (): SessionMetadataLocksShape => {
  const locks = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
  return {
    withLock: (ref, effect) => {
      const key = `${ref.projectId}\0${ref.sessionId}`;
      const lock = locks.get(key) ?? Semaphore.makeUnsafe(1);
      locks.set(key, lock);
      return lock.withPermit(effect);
    },
    release: (ref) =>
      Effect.sync(() => {
        locks.delete(`${ref.projectId}\0${ref.sessionId}`);
      }),
    size: Effect.sync(() => locks.size),
  };
};

export const SessionMetadataLocksLayer: Layer.Layer<SessionMetadataLocks> = Layer.effect(
  SessionMetadataLocks,
  Effect.sync(makeSessionMetadataLocks),
);
