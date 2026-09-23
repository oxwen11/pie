import type { SubscribeStreamEvent, SubscriptionScope } from "@getpie/contract";
import { Stream } from "effect";

import type { EventBusShape } from "../events";

/**
 * Open a scoped subscription on the {@link EventBusShape}. `Stream.unwrap`
 * runs `subscribe` in the stream's own scope, so a client disconnect (or an
 * interrupt before the first pull) removes the subscriber. A hand-rolled
 * `Scope.make` is not a child of that scope and leaks if the fiber is
 * interrupted after subscribe and before the ensuring stream is returned.
 */
export const openScopedSubscription = (
  bus: EventBusShape,
  scope: SubscriptionScope,
): Stream.Stream<SubscribeStreamEvent> => Stream.unwrap(bus.subscribe(scope));
