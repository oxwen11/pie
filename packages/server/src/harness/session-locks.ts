import type { SessionRef } from "@getpie/contract";
import { Context, Effect, Layer, Semaphore, SynchronizedRef } from "effect";

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

const refKey = (ref: SessionRef): string => `${ref.projectId}\0${ref.sessionId}`;

export const SessionMetadataLocksLayer: Layer.Layer<SessionMetadataLocks> = Layer.effect(
  SessionMetadataLocks,
  Effect.gen(function* () {
    const table = yield* SynchronizedRef.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());

    const semaphoreFor = (key: string) =>
      SynchronizedRef.modifyEffect(table, (current) => {
        const existing = current.get(key);
        if (existing !== undefined) {
          return Effect.succeed([existing, current] as const);
        }
        return Semaphore.make(1).pipe(
          Effect.map((created) => [created, new Map([...current, [key, created]])] as const),
        );
      });

    return {
      withLock: (ref, effect) =>
        semaphoreFor(refKey(ref)).pipe(Effect.flatMap((lock) => lock.withPermit(effect))),
      release: (ref) =>
        SynchronizedRef.update(table, (current) => {
          const key = refKey(ref);
          if (!current.has(key)) return current;
          const next = new Map(current);
          next.delete(key);
          return next;
        }),
      size: SynchronizedRef.get(table).pipe(Effect.map((current) => current.size)),
    } satisfies SessionMetadataLocksShape;
  }),
);
