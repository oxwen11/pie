import type { SubscribeStreamEvent, SubscriptionScope } from "@getpie/contract";
import { Effect, Exit, Scope, Stream } from "effect";

import type { EventBusShape } from "../events";

/**
 * Open a scoped subscription on the {@link EventBusShape} and hand back a stream
 * whose own scope is torn down when the stream ends — so a client disconnect
 * removes the subscriber from the bus.
 *
 * Effect 4's `Stream.unwrap` drops `Scope` from `R` by tying the inner stream
 * to the fiber that unwraps it. This RPC returns an AsyncGenerator that outlives
 * that Effect, so the subscription Scope is created here and closed when the
 * generator ends (`Stream.ensuring`).
 */
export const openScopedSubscription = (
  bus: EventBusShape,
  scope: SubscriptionScope,
): Effect.Effect<Stream.Stream<SubscribeStreamEvent>> =>
  Effect.gen(function* () {
    const subscriptionScope = yield* Scope.make();
    const stream = yield* bus
      .subscribe(scope)
      .pipe(Effect.provideService(Scope.Scope, subscriptionScope));
    return stream.pipe(Stream.ensuring(Scope.close(subscriptionScope, Exit.void)));
  });
