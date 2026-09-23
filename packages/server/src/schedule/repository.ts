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
  pendingRuns: Schema.optionalKey(Schema.Array(ScheduleRunSchema)),
});
type StoredSchedule = typeof StoredScheduleSchema.Type;

const toStored = (schedule: Schedule, pendingRuns?: ReadonlyArray<ScheduleRun>): StoredSchedule => {
  const { runs, ...state } = schedule;
  return {
    ...state,
    runIds: runs.map((run) => run.id),
    ...(pendingRuns !== undefined && pendingRuns.length > 0 ? { pendingRuns } : undefined),
  };
};

const fromStored = (stored: StoredSchedule, runs: ReadonlyArray<ScheduleRun>): Schedule => {
  const { pendingRuns: _pendingRuns, runIds: _runIds, ...state } = stored;
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
        const pending = new Map(stored.pendingRuns?.map((run) => [run.id, run]));
        const storedRuns = yield* Effect.forEach(
          stored.runIds,
          (runId) => {
            const pendingRun = pending.get(runId);
            return pendingRun !== undefined
              ? Effect.succeed(pendingRun)
              : runs.get(runKey(id, runId)).pipe(
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
                );
          },
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

    const commit = (current: Schedule | undefined, next: Schedule) =>
      Effect.gen(function* () {
        const previous = new Map<string, ScheduleRun>();
        for (const run of current?.runs ?? []) previous.set(run.id, run);
        const changed = next.runs.filter(
          (run) => !util.isDeepStrictEqual(previous.get(run.id), run),
        );
        const storedCurrent =
          current === undefined
            ? Option.none<StoredSchedule>()
            : yield* schedules.get(scheduleKey(next.id)).pipe(Effect.mapError(asWriteError));
        const pendingIds = new Set(
          Option.isSome(storedCurrent)
            ? (storedCurrent.value.pendingRuns?.map((run) => run.id) ?? [])
            : [],
        );
        for (const run of changed) pendingIds.add(run.id);
        const pendingRuns = next.runs.filter((run) => pendingIds.has(run.id));

        yield* schedules
          .put(scheduleKey(next.id), toStored(next, pendingRuns))
          .pipe(Effect.mapError(asWriteError));

        const materialized = yield* Effect.forEach(
          pendingRuns,
          (run) => runs.put(runKey(next.id, run.id), run).pipe(Effect.mapError(asWriteError)),
          { concurrency: 16, discard: true },
        ).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("schedule run materialization failed").pipe(
              Effect.annotateLogs({
                event: "schedule.run_materialization_failed",
                scheduleId: next.id,
                file: error.file,
              }),
              Effect.as(false),
            ),
          ),
        );
        if (materialized && pendingRuns.length > 0) {
          yield* schedules.put(scheduleKey(next.id), toStored(next)).pipe(
            Effect.mapError(asWriteError),
            Effect.catch((error) =>
              Effect.logWarning("schedule run finalization failed").pipe(
                Effect.annotateLogs({
                  event: "schedule.run_finalization_failed",
                  scheduleId: next.id,
                  file: error.file,
                }),
              ),
            ),
          );
        }
        yield* garbageCollectRuns(next);
      });

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
      create: (schedule) => withLock(schedule.id, commit(undefined, schedule)),
      replace: (current, next) =>
        current.id !== next.id
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
