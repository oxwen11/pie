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
    readonly write: (schedule: Schedule) => Effect.Effect<void, StoreWriteError>;
    readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
  }
>()("ScheduleRepository") {}

const isSafeId = (id: string): boolean =>
  id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== "..";

export const makeScheduleRepository = (schedulesDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const locks = new Map<string, Semaphore.Semaphore>();
    const scheduleDir = (id: string) => path.join(schedulesDir, id);
    const runsDir = (id: string) => path.join(scheduleDir(id), "runs");
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
    const stores = (id: string) =>
      Effect.all({
        schedule: makeJsonCollection({
          dir: scheduleDir(id),
          schema: StoredScheduleSchema,
        }),
        runs: makeJsonCollection({
          dir: runsDir(id),
          schema: ScheduleRunSchema,
        }),
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));

    const readUnlocked = (id: string) =>
      Effect.gen(function* () {
        const store = yield* stores(id);
        const found = yield* store.schedule.get("schedule").pipe(Effect.mapError(asReadError));
        if (Option.isNone(found)) {
          return yield* Effect.fail(new ScheduleNotFound({ scheduleId: id }));
        }
        const stored = found.value;
        const runs = yield* Effect.forEach(
          stored.runIds,
          (runId) =>
            store.runs.get(runId).pipe(
              Effect.mapError(asReadError),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new StoreReadError({
                        file: path.join(runsDir(id), `${runId}.json`),
                        cause: new Error(`schedule run ${runId} is missing`),
                      }),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            ),
          { concurrency: 16 },
        );
        return fromStored(stored, runs);
      });

    const read = (id: string) =>
      !isSafeId(id)
        ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
        : withLock(id, readUnlocked(id));

    return {
      list: () =>
        fs.readDirectory(schedulesDir).pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed([])
              : Effect.fail(new StoreReadError({ file: schedulesDir, cause: error })),
          ),
          Effect.flatMap((names) =>
            Effect.forEach(
              names.filter(isSafeId),
              (id) =>
                fs.stat(scheduleDir(id)).pipe(
                  Effect.map((info) =>
                    info.type === "Directory" ? Option.some(id) : Option.none(),
                  ),
                  Effect.catch((error) =>
                    error.reason._tag === "NotFound"
                      ? Effect.succeed(Option.none<string>())
                      : Effect.fail(new StoreReadError({ file: scheduleDir(id), cause: error })),
                  ),
                ),
              { concurrency: 16 },
            ),
          ),
          Effect.map((ids) => ids.flatMap((id) => (Option.isSome(id) ? [id.value] : []))),
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
      write: (schedule) =>
        !isSafeId(schedule.id)
          ? Effect.die(new Error(`invariant: invalid schedule id ${JSON.stringify(schedule.id)}`))
          : withLock(
              schedule.id,
              Effect.gen(function* () {
                const store = yield* stores(schedule.id);
                const existing = yield* store.runs.list().pipe(Effect.mapError(asWriteError));
                const existingById = new Map(existing.map((entry) => [entry.id, entry.data]));
                const retained = new Set(schedule.runs.map((run) => run.id));
                yield* Effect.forEach(
                  schedule.runs,
                  (run) =>
                    util.isDeepStrictEqual(existingById.get(run.id), run)
                      ? Effect.void
                      : store.runs.put(run.id, run).pipe(Effect.mapError(asWriteError)),
                  { concurrency: 1, discard: true },
                );
                yield* store.schedule
                  .put("schedule", toStored(schedule))
                  .pipe(Effect.mapError(asWriteError));
                yield* Effect.forEach(
                  existing,
                  (entry) =>
                    retained.has(entry.id)
                      ? Effect.void
                      : store.runs.remove(entry.id).pipe(Effect.mapError(asWriteError)),
                  { concurrency: 1, discard: true },
                );
              }),
            ),
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
