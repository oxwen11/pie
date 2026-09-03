import type { CreateScheduleInput, Schedule, UpdateScheduleInput } from "@getpie/contract";
import { Context, Crypto, Effect, Layer } from "effect";

import type {
  InvalidSchedule,
  ProjectNotFound,
  ScheduleLimitReached,
  ScheduleNotFound,
  StoreReadError,
  StoreWriteError,
} from "../errors";
import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import type { FireResult } from "./fire";
import * as mutations from "./mutations";
import { ScheduleRepository } from "./repository";
import { ScheduleRuntime, ScheduleRuntimeLayer, type ScheduleServiceEnv } from "./runtime";
import { tick } from "./tick";

export type { FireResult };

export type ScheduleServiceShape = {
  readonly list: () => Effect.Effect<ReadonlyArray<Schedule>, StoreReadError>;
  readonly get: (id: string) => Effect.Effect<Schedule, StoreReadError | ScheduleNotFound>;
  readonly create: (
    input: CreateScheduleInput,
  ) => Effect.Effect<
    Schedule,
    StoreReadError | StoreWriteError | ProjectNotFound | InvalidSchedule | ScheduleLimitReached
  >;
  readonly update: (
    input: UpdateScheduleInput,
  ) => Effect.Effect<
    Schedule,
    StoreReadError | StoreWriteError | ScheduleNotFound | InvalidSchedule
  >;
  readonly delete: (
    id: string,
  ) => Effect.Effect<void, StoreReadError | StoreWriteError | ScheduleNotFound>;
  readonly runNow: (
    id: string,
  ) => Effect.Effect<FireResult, StoreReadError | StoreWriteError | ScheduleNotFound>;
  readonly tick: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
  readonly recover: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
  readonly nextWakeDelay: () => Effect.Effect<number, StoreReadError>;
};

export class ScheduleService extends Context.Service<ScheduleService, ScheduleServiceShape>()(
  "pie/ScheduleService",
) {}

export const ScheduleServiceLayer: Layer.Layer<
  ScheduleService,
  never,
  ScheduleRepository | ProjectService | PiAgentSessionService | Crypto.Crypto
> = Layer.effect(
  ScheduleService,
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const crypto = yield* Crypto.Crypto;
    const runtime = yield* ScheduleRuntime;
    // Only these five — do not capture Logger/Clock from layer build, or
    // TestClock / captureLogs lose to the frozen context.
    const env = Context.make(ScheduleRepository, repo).pipe(
      Context.add(ProjectService, projects),
      Context.add(PiAgentSessionService, sessions),
      Context.add(Crypto.Crypto, crypto),
      Context.add(ScheduleRuntime, runtime),
    );
    // Shape stays R-free. Modules yield* services; this seam provides them.
    const provide = <A, E>(effect: Effect.Effect<A, E, ScheduleServiceEnv>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provide(env));
    return {
      list: Effect.fn("ScheduleService.list")(function* () {
        return yield* provide(mutations.list());
      }),
      get: Effect.fn("ScheduleService.get")(function* (id: string) {
        return yield* provide(mutations.get(id));
      }),
      create: Effect.fn("ScheduleService.create")(function* (input: CreateScheduleInput) {
        return yield* provide(mutations.create(input));
      }),
      update: Effect.fn("ScheduleService.update")(function* (input: UpdateScheduleInput) {
        return yield* provide(mutations.update(input));
      }),
      delete: Effect.fn("ScheduleService.delete")(function* (id: string) {
        return yield* provide(mutations.remove(id));
      }),
      runNow: Effect.fn("ScheduleService.runNow")(function* (id: string) {
        return yield* provide(mutations.runNow(id));
      }),
      tick: Effect.fn("ScheduleService.tick")(function* () {
        return yield* provide(tick());
      }),
      recover: Effect.fn("ScheduleService.recover")(function* () {
        return yield* provide(mutations.recover());
      }),
      nextWakeDelay: Effect.fn("ScheduleService.nextWakeDelay")(function* () {
        return yield* provide(mutations.nextWakeDelay());
      }),
    };
  }),
).pipe(Layer.provide(ScheduleRuntimeLayer));
