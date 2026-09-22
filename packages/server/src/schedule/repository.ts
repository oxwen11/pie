import path from "node:path";
import util from "node:util";

import {
  ScheduleRunSchema,
  ScheduleStateSchema,
  type Schedule,
  type ScheduleRun,
} from "@getpie/contract";
import { type JsonStoreLoadError, makeJsonCollection } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Option, Schema, Semaphore } from "effect";

import { Paths } from "../config/paths";
import { ScheduleNotFound, StoreReadError, StoreWriteError } from "../errors";

const StoredScheduleSchema = Schema.Struct({
  ...ScheduleStateSchema.fields,
  runIds: Schema.Array(Schema.String),
});
type StoredSchedule = typeof StoredScheduleSchema.Type;

const toStored = (schedule: Schedule): StoredSchedule => {
  const { runs, ...state } = schedule;
  return { ...state, runIds: runs.map((run) => run.id) };
};

const fromStored = (stored: StoredSchedule, runs: ReadonlyArray<ScheduleRun>): Schedule => {
  const { runIds: _runIds, ...state } = stored;
  return { ...state, runs };
};

export class ScheduleRepository extends Context.Service<
  ScheduleRepository,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Schedule>, StoreReadError>;
    readonly read: (id: string) => Effect.Effect<Schedule, StoreReadError | ScheduleNotFound>;
    readonly create: (schedule: Schedule) => Effect.Effect<void, StoreWriteError>;
    readonly replace: (current: Schedule, next: Schedule) => Effect.Effect<void, StoreWriteError>;
    readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
  }
>()("ScheduleRepository") {}

const isSafeId = (id: string): boolean =>
  id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== "..";

export const makeScheduleRepository = (schedulesDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const schedules = yield* makeJsonCollection({
      dir: schedulesDir,
      schema: StoredScheduleSchema,
    });
    const runs = yield* makeJsonCollection({
      dir: schedulesDir,
      schema: ScheduleRunSchema,
    });
    const locks = new Map<string, Semaphore.Semaphore>();
    const scheduleDir = (id: string) => path.join(schedulesDir, id);
    const scheduleKey = (id: string) => `${id}/schedule`;
    const runPrefix = (id: string) => `${id}/runs`;
    const runKey = (id: string, runId: string) => `${runPrefix(id)}/${runId}`;
    const asReadError = (error: JsonStoreLoadError) =>
      new StoreReadError({ file: error.file, cause: error });
    const asWriteError = (error: { readonly file: string }) =>
      new StoreWriteError({ file: error.file, cause: error });
    const withLock = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        let lock = locks.get(id);
        if (lock === undefined) {
          lock = Semaphore.makeUnsafe(1);
          locks.set(id, lock);
        }
        return lock.withPermit(effect);
      });

    const readUnlocked = (id: string) =>
      Effect.gen(function* () {
        const found = yield* schedules.get(scheduleKey(id)).pipe(Effect.mapError(asReadError));
        if (Option.isNone(found)) {
          return yield* Effect.fail(new ScheduleNotFound({ scheduleId: id }));
        }
        const stored = found.value;
        const storedRuns = yield* Effect.forEach(
          stored.runIds,
          (runId) =>
            runs.get(runKey(id, runId)).pipe(
              Effect.mapError(asReadError),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new StoreReadError({
                        file: path.join(scheduleDir(id), "runs", `${runId}.json`),
                        cause: new Error(`schedule run ${runId} is missing`),
                      }),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            ),
          { concurrency: 16 },
        );
        return fromStored(stored, storedRuns);
      });

    const read = (id: string) =>
      !isSafeId(id)
        ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
        : withLock(id, readUnlocked(id));

    const collectScheduleIds = schedules.ids().pipe(
      Effect.mapError(asReadError),
      Effect.map((ids) =>
        ids.flatMap((id) => {
          const [scheduleId, file, extra] = id.split("/");
          return scheduleId !== undefined &&
            file === "schedule" &&
            extra === undefined &&
            isSafeId(scheduleId)
            ? [scheduleId]
            : [];
        }),
      ),
    );

    const garbageCollectRuns = (schedule: Schedule) => {
      const retained = new Set(schedule.runs.map((run) => runKey(schedule.id, run.id)));
      return runs.ids({ under: runPrefix(schedule.id) }).pipe(
        Effect.mapError(asWriteError),
        Effect.flatMap((ids) =>
          Effect.forEach(
            ids,
            (id) =>
              retained.has(id) ? Effect.void : runs.remove(id).pipe(Effect.mapError(asWriteError)),
            { concurrency: 16, discard: true },
          ),
        ),
        Effect.catch((error) =>
          Effect.logWarning("schedule run cleanup failed").pipe(
            Effect.annotateLogs({
              event: "schedule.run_cleanup_failed",
              scheduleId: schedule.id,
              file: error.file,
            }),
          ),
        ),
      );
    };

    const commit = (current: Schedule | undefined, next: Schedule) => {
      const previous = new Map<string, ScheduleRun>();
      for (const run of current?.runs ?? []) previous.set(run.id, run);
      return Effect.gen(function* () {
        yield* Effect.forEach(
          next.runs,
          (run) =>
            util.isDeepStrictEqual(previous.get(run.id), run)
              ? Effect.void
              : runs.put(runKey(next.id, run.id), run).pipe(Effect.mapError(asWriteError)),
          { concurrency: 16, discard: true },
        );
        yield* schedules
          .put(scheduleKey(next.id), toStored(next))
          .pipe(Effect.mapError(asWriteError));
        yield* garbageCollectRuns(next);
      });
    };

    return {
      list: () =>
        collectScheduleIds.pipe(
          Effect.flatMap((ids) =>
            Effect.forEach(
              ids,
              (id) =>
                read(id).pipe(
                  Effect.map(Option.some),
                  Effect.catchTag("ScheduleNotFound", () =>
                    Effect.succeed(Option.none<Schedule>()),
                  ),
                ),
              { concurrency: 16 },
            ),
          ),
          Effect.map((items) => items.flatMap((item) => (Option.isSome(item) ? [item.value] : []))),
        ),
      read,
      create: (schedule) =>
        !isSafeId(schedule.id)
          ? Effect.die(new Error(`invariant: invalid schedule id ${JSON.stringify(schedule.id)}`))
          : withLock(schedule.id, commit(undefined, schedule)),
      replace: (current, next) =>
        !isSafeId(next.id) || current.id !== next.id
          ? Effect.die(
              new Error(
                `invariant: cannot replace schedule ${JSON.stringify(current.id)} with ${JSON.stringify(next.id)}`,
              ),
            )
          : withLock(next.id, commit(current, next)),
      remove: (id) =>
        !isSafeId(id)
          ? Effect.void
          : withLock(
              id,
              fs
                .remove(scheduleDir(id), { recursive: true })
                .pipe(
                  Effect.catch((error) =>
                    error.reason._tag === "NotFound"
                      ? Effect.void
                      : Effect.fail(new StoreWriteError({ file: scheduleDir(id), cause: error })),
                  ),
                ),
            ),
    } satisfies ScheduleRepository["Service"];
  });

export const ScheduleRepositoryLayer: Layer.Layer<
  ScheduleRepository,
  never,
  Paths | FileSystem.FileSystem
> = Layer.effect(
  ScheduleRepository,
  Effect.gen(function* () {
    const paths = yield* Paths;
    return yield* makeScheduleRepository(paths.schedulesDir);
  }),
);
