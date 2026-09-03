import type { SubscribeStreamEvent, SubscriptionScope } from "@getpie/contract";
import { Effect, Stream } from "effect";

import type { EventBusShape } from "../events";

/**
 * Open a scoped subscription on the {@link EventBusShape} and hand back a stream
 * whose own scope is torn down when the stream ends — so a client disconnect
 * removes the subscriber from the bus.
 */
export const openScopedSubscription = (
  bus: EventBusShape,
  scope: SubscriptionScope,
): Effect.Effect<Stream.Stream<SubscribeStreamEvent>> =>
  Effect.succeed(Stream.unwrap(bus.subscribe(scope)));
