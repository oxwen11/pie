import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Schedule, ScheduleRun } from "@getpie/contract";
import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeScheduleRepository, ScheduleRepository } from "../../src/schedule/repository";
import { NodePlatformLayer } from "../platform";

const SCHEDULE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STARTED_AT = "2026-09-20T10:00:00.000Z";

class TestScheduleRepository extends Context.Service<
  TestScheduleRepository,
  ScheduleRepository["Service"]
>()("test/TestScheduleRepository") {}

const runRecord = (id: string, status: ScheduleRun["status"] = "running"): ScheduleRun => ({
  id,
  startedAt: STARTED_AT,
  reason: "manual",
  status,
  snapshot: {
    name: "Daily review",
    prompt: "Review the project.",
    projectId: PROJECT_ID,
    spec: { kind: "manual" },
    session: { policy: "isolated" },
  },
});

const schedule = (runs: ReadonlyArray<ScheduleRun> = []): Schedule => ({
  id: SCHEDULE_ID,
  name: "Daily review",
  projectId: PROJECT_ID,
  prompt: "Review the project.",
  spec: { kind: "manual" },
  enabled: true,
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
  nextRunAt: null,
  runs,
});

describe("ScheduleRepository", () => {
  let home: string;
  let schedulesDir: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-schedules-"));
    schedulesDir = path.join(home, "storage", "schedules");
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const run = <A, E>(program: Effect.Effect<A, E, TestScheduleRepository>) =>
    Effect.runPromise(
      Effect.provide(
        program,
        Layer.effect(TestScheduleRepository, makeScheduleRepository(schedulesDir)).pipe(
          Layer.provide(NodePlatformLayer),
        ),
      ),
    );

  it("stores the Schedule and each Run in the Schedule directory", async () => {
    const expected = schedule([runRecord("run-1")]);
    const read = await run(
      Effect.gen(function* () {
        const repo = yield* TestScheduleRepository;
        yield* repo.write(expected);
        return yield* repo.read(SCHEDULE_ID);
      }),
    );

    expect(read).toEqual(expected);
    const storedSchedule = JSON.parse(
      await fs.readFile(path.join(schedulesDir, SCHEDULE_ID, "schedule.json"), "utf8"),
    ) as { readonly data: Record<string, unknown> };
    expect(storedSchedule.data).not.toHaveProperty("runs");
    expect(storedSchedule.data.runIds).toEqual(["run-1"]);
    const storedRun = JSON.parse(
      await fs.readFile(path.join(schedulesDir, SCHEDULE_ID, "runs", "run-1.json"), "utf8"),
    ) as { readonly data: { readonly id: string } };
    expect(storedRun.data.id).toBe("run-1");
  });

  it("preserves Run order and removes Runs outside the retained window", async () => {
    const read = await run(
      Effect.gen(function* () {
        const repo = yield* TestScheduleRepository;
        yield* repo.write(schedule([runRecord("run-1"), runRecord("run-0")]));
        yield* repo.write(schedule([runRecord("run-2"), runRecord("run-1", "succeeded")]));
        return yield* repo.read(SCHEDULE_ID);
      }),
    );

    expect(read.runs.map((item) => item.id)).toEqual(["run-2", "run-1"]);
    expect(read.runs[1]?.status).toBe("succeeded");
    await expect(
      fs.access(path.join(schedulesDir, SCHEDULE_ID, "runs", "run-0.json")),
    ).rejects.toThrow("ENOENT");
  });

  it("does not adopt the retired flat-file layout", async () => {
    await fs.mkdir(schedulesDir, { recursive: true });
    await fs.writeFile(
      path.join(schedulesDir, `${SCHEDULE_ID}.json`),
      JSON.stringify({ version: 1, data: schedule() }),
    );

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* TestScheduleRepository;
        const listed = yield* repo.list();
        const error = yield* Effect.flip(repo.read(SCHEDULE_ID));
        return { listed, error };
      }),
    );

    expect(result.listed).toEqual([]);
    expect(result.error._tag).toBe("ScheduleNotFound");
  });

  it("removes the Schedule and all of its Runs", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* TestScheduleRepository;
        yield* repo.write(schedule([runRecord("run-1")]));
        yield* repo.remove(SCHEDULE_ID);
      }),
    );

    await expect(fs.access(path.join(schedulesDir, SCHEDULE_ID))).rejects.toThrow("ENOENT");
  });
});
