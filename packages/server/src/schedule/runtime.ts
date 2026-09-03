import { Context, Crypto, Effect, Layer, Semaphore } from "effect";

import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { ScheduleRepository } from "./repository";

export type ScheduleRuntimeShape = {
  readonly inFlight: Set<string>;
  readonly tickGate: Semaphore.Semaphore;
};

export class ScheduleRuntime extends Context.Service<ScheduleRuntime, ScheduleRuntimeShape>()(
  "ScheduleRuntime",
) {}

export const ScheduleRuntimeLayer: Layer.Layer<ScheduleRuntime> = Layer.sync(
  ScheduleRuntime,
  () => ({
    inFlight: new Set<string>(),
    tickGate: Semaphore.makeUnsafe(1),
  }),
);

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
