import { Context, Crypto, Effect, HashSet, Layer, Ref, Scope, Semaphore } from "effect";

import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { ScheduleRepository } from "./repository";

export type ScheduleRuntimeShape = {
  readonly inFlight: Ref.Ref<HashSet.HashSet<string>>;
  readonly tickGate: Semaphore.Semaphore;
  readonly scope: Scope.Scope;
};

export class ScheduleRuntime extends Context.Service<ScheduleRuntime, ScheduleRuntimeShape>()(
  "ScheduleRuntime",
) {}

export const ScheduleRuntimeLayer: Layer.Layer<ScheduleRuntime> = Layer.effect(
  ScheduleRuntime,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const inFlight = yield* Ref.make(HashSet.empty<string>());
    const tickGate = yield* Semaphore.make(1);
    return { inFlight, tickGate, scope };
  }),
);

export const claimInFlight = (id: string): Effect.Effect<boolean, never, ScheduleRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* ScheduleRuntime;
    return yield* Ref.modify(runtime.inFlight, (set) =>
      HashSet.has(set, id) ? ([false, set] as const) : ([true, HashSet.add(set, id)] as const),
    );
  });

export const releaseInFlight = (id: string): Effect.Effect<void, never, ScheduleRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* ScheduleRuntime;
    yield* Ref.update(runtime.inFlight, (set) => HashSet.remove(set, id));
  });

export type ScheduleServiceEnv =
  | ScheduleRepository
  | ProjectService
  | PiAgentSessionService
  | Crypto.Crypto
  | ScheduleRuntime;

export const newScheduleId: Effect.Effect<string, never, Crypto.Crypto> = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  return yield* crypto.randomUUIDv4.pipe(
    Effect.catchTag("PlatformError", (cause) =>
      Effect.die(new Error("invariant: platform RNG failed minting a schedule id", { cause })),
    ),
  );
});

export const logSchedule = (entry: {
  readonly event: string;
  readonly message: string;
  readonly level?: "info" | "warn";
  readonly annotations?: Record<string, unknown>;
}): Effect.Effect<void> => {
  const log =
    entry.level === "warn" ? Effect.logWarning(entry.message) : Effect.logInfo(entry.message);
  return log.pipe(Effect.annotateLogs({ event: entry.event, ...entry.annotations }));
};
