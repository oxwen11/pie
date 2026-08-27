import "@orpc/experimental-effect/extensions/effect";
import { scheduleContract } from "@getpie/contract/schedule";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { ScheduleService } from "../schedule";
import type { RpcContext } from "./context";

const orpc = implement(scheduleContract).$context<RpcContext>();

export const scheduleRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const schedules = yield* ScheduleService;
    return yield* schedules.list();
  }),
  get: orpc.get.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.get(input.id).pipe(
      Effect.catchTags({
        ScheduleNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `schedule ${e.scheduleId} not found` })),
      }),
    );
  }),
  create: orpc.create.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.create(input).pipe(
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        InvalidSchedule: (e) => Effect.fail(errors.INVALID_ARGUMENT({ message: e.reason })),
        ScheduleLimitReached: (e) =>
          Effect.fail(errors.INVALID_ARGUMENT({ message: `already have ${e.limit} schedules` })),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.update(input).pipe(
      Effect.catchTags({
        ScheduleNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `schedule ${e.scheduleId} not found` })),
        InvalidSchedule: (e) => Effect.fail(errors.INVALID_ARGUMENT({ message: e.reason })),
      }),
    );
  }),
  delete: orpc.delete.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    yield* schedules.delete(input.id).pipe(
      Effect.catchTags({
        ScheduleNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `schedule ${e.scheduleId} not found` })),
      }),
    );
  }),
  runNow: orpc.runNow.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.runNow(input.id).pipe(
      Effect.catchTags({
        ScheduleNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `schedule ${e.scheduleId} not found` })),
      }),
    );
  }),
});

export type ScheduleRouter = typeof scheduleRouter;
