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
import { ScheduleRuntimeLayer, type ScheduleServiceEnv } from "./runtime";
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
  "ScheduleService",
) {}

export const ScheduleServiceLayer: Layer.Layer<
  ScheduleService,
  never,
  ScheduleRepository | ProjectService | PiAgentSessionService | Crypto.Crypto
> = Layer.effect(
  ScheduleService,
  Effect.gen(function* () {
    const env = yield* Effect.context<ScheduleServiceEnv>();
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provide(env as never));
    return {
      list: () => provide(mutations.list()),
      get: (id) => provide(mutations.get(id)),
      create: (input) => provide(mutations.create(input)),
      update: (input) => provide(mutations.update(input)),
      delete: (id) => provide(mutations.remove(id)),
      runNow: (id) => provide(mutations.runNow(id)),
      tick: () => provide(tick()),
      recover: () => provide(mutations.recover()),
      nextWakeDelay: () => provide(mutations.nextWakeDelay()),
    };
  }),
).pipe(Layer.provide(ScheduleRuntimeLayer));
