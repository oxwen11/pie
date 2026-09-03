import { ScheduleSchema, type Schedule } from "@getpie/contract";
import { type JsonStoreLoadError, makeJsonCollection } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Option } from "effect";

import { Paths } from "../config/paths";
import { ScheduleNotFound, StoreReadError, StoreWriteError } from "../errors";

export class ScheduleRepository extends Context.Service<
  ScheduleRepository,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Schedule>, StoreReadError>;
    readonly read: (id: string) => Effect.Effect<Schedule, StoreReadError | ScheduleNotFound>;
    readonly write: (schedule: Schedule) => Effect.Effect<void, StoreWriteError>;
    readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
  }
>()("ScheduleRepository") {}

const isSafeId = (id: string): boolean =>
  id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== "..";

export const ScheduleRepositoryLayer: Layer.Layer<
  ScheduleRepository,
  never,
  Paths | FileSystem.FileSystem
> = Layer.effect(
  ScheduleRepository,
  Effect.gen(function* () {
    const paths = yield* Paths;
    const schedules = yield* makeJsonCollection({
      dir: paths.schedulesDir,
      schema: ScheduleSchema,
    });
    const asReadError = (error: JsonStoreLoadError) =>
      new StoreReadError({ file: error.file, cause: error });
    const asWriteError = (error: { readonly file: string }) =>
      new StoreWriteError({ file: error.file, cause: error });

    return {
      list: () =>
        schedules.list().pipe(
          Effect.map((entries) => entries.map((entry) => entry.data)),
          Effect.mapError(asReadError),
        ),
      read: (id) =>
        !isSafeId(id)
          ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
          : schedules.get(id).pipe(
              Effect.mapError(asReadError),
              Effect.flatMap((found) =>
                Option.isSome(found)
                  ? Effect.succeed(found.value)
                  : Effect.fail(new ScheduleNotFound({ scheduleId: id })),
              ),
            ),
      write: (schedule) => schedules.put(schedule.id, schedule).pipe(Effect.mapError(asWriteError)),
      remove: (id) =>
        !isSafeId(id) ? Effect.void : schedules.remove(id).pipe(Effect.mapError(asWriteError)),
    };
  }),
);
