import type { SubscribeStreamEvent, SubscriptionScope } from "@getpie/contract";
import { Effect, Exit, Scope, Stream } from "effect";

import type { EventBusShape } from "../events";

/**
 * Register a bus subscriber before this effect returns, and remove it when the
 * stream ends. `Stream.unwrap` waits for the first pull, so an event published
 * after `subscribe` resolves and before the client reads is lost.
 * The scope is independent: the RPC effect's scope closes as soon as it
 * returns the generator. `onInterrupt` covers a disconnect before return.
 */
export const openScopedSubscription = (
  bus: EventBusShape,
  scope: SubscriptionScope,
): Effect.Effect<Stream.Stream<SubscribeStreamEvent>> =>
  Effect.gen(function* () {
    const subscriptionScope = yield* Scope.make();
    const stream = yield* bus.subscribe(scope).pipe(
      Effect.provideService(Scope.Scope, subscriptionScope),
      Effect.onInterrupt(() => Scope.close(subscriptionScope, Exit.void)),
    );
    return stream.pipe(Stream.ensuring(Scope.close(subscriptionScope, Exit.void)));
  });
