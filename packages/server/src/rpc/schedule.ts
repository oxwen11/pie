import { scheduleContract } from "@getpie/contract/schedule";
import { Effect } from "effect";

import { ScheduleService } from "../schedule";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { catchScheduleNotFound, projectNotFound, scheduleNotFound } from "./wire";

const orpc = implement(scheduleContract).$context<RpcContext>();

export const scheduleRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const schedules = yield* ScheduleService;
    return yield* schedules.list();
  }),
  get: orpc.get.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.get(input.id).pipe(catchScheduleNotFound(errors));
  }),
  create: orpc.create.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.create(input).pipe(
      Effect.catchTags({
        ProjectNotFound: projectNotFound(errors),
        InvalidSchedule: (error) => Effect.fail(errors.INVALID_ARGUMENT({ message: error.reason })),
        ScheduleLimitReached: (error) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({ message: `already have ${error.limit} schedules` }),
          ),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.update(input).pipe(
      Effect.catchTags({
        ScheduleNotFound: scheduleNotFound(errors),
        InvalidSchedule: (error) => Effect.fail(errors.INVALID_ARGUMENT({ message: error.reason })),
      }),
    );
  }),
  delete: orpc.delete.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    yield* schedules.delete(input.id).pipe(catchScheduleNotFound(errors));
  }),
  runNow: orpc.runNow.effect(function* ({ input, errors }) {
    const schedules = yield* ScheduleService;
    return yield* schedules.runNow(input.id).pipe(catchScheduleNotFound(errors));
  }),
});

export type ScheduleRouter = typeof scheduleRouter;
