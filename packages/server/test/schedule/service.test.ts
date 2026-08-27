import type { CreateScheduleInput, Schedule, SessionRef } from "@getpie/contract";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectNotFound, ScheduleNotFound, StoreWriteError } from "../../src/errors";
import {
  makeScheduleService,
  type ScheduleSessions,
  type ScheduleStore,
} from "../../src/schedule/service";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const cronInput = (overrides: Partial<CreateScheduleInput> = {}): CreateScheduleInput => ({
  name: "Morning review",
  projectId: PROJECT_ID,
  prompt: "Review yesterday's commits.",
  spec: { kind: "cron", expr: "0 9 * * *" },
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

function memoryStore(initial: ReadonlyArray<Schedule> = []): ScheduleStore {
  const store = new Map<string, Schedule>(initial.map((schedule) => [schedule.id, schedule]));
  return {
    list: () => Effect.succeed(Array.from(store.values())),
    read: (id) => {
      const found = store.get(id);
      return found === undefined
        ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
        : Effect.succeed(found);
    },
    write: (schedule) =>
      Effect.sync(() => {
        store.set(schedule.id, schedule);
      }),
    remove: (id) =>
      Effect.sync(() => {
        store.delete(id);
      }),
  };
}

function setup(opts: { readonly live?: boolean; readonly missingProject?: boolean } = {}) {
  const store = new Map<string, Schedule>();
  let next = 1;
  let clock = Date.parse("2026-08-27T08:00:00.000Z");
  const created: Array<{ title?: string; scheduleId?: string; projectId: string }> = [];
  const prompted: SessionRef[] = [];
  const repo: ScheduleStore = {
    list: () => Effect.succeed(Array.from(store.values())),
    read: (id) => {
      const found = store.get(id);
      return found === undefined
        ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
        : Effect.succeed(found);
    },
    write: (schedule) =>
      Effect.sync(() => {
        store.set(schedule.id, schedule);
      }),
    remove: (id) =>
      Effect.sync(() => {
        store.delete(id);
      }),
  };
  const sessions: ScheduleSessions = {
    create: (input) =>
      Effect.sync(() => {
        created.push({
          projectId: input.projectId,
          ...(input.title !== undefined ? { title: input.title } : undefined),
          ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : undefined),
        });
        return {
          ref: { projectId: input.projectId, sessionId: `sess-${created.length}` },
          workspace: { cwd: input.cwd },
        };
      }),
    prompt: (input) =>
      Effect.sync(() => {
        prompted.push(input.ref);
        return { turnId: "turn-1" };
      }),
    getStatus: () => Effect.succeed({ phase: opts.live === true ? "running" : "idle" }),
  };
  const service = makeScheduleService({
    repo,
    projects: {
      findById: (id) =>
        opts.missingProject === true || id !== PROJECT_ID
          ? Effect.fail(new ProjectNotFound({ projectId: id }))
          : Effect.succeed({ path: "/tmp/app" }),
    },
    sessions,
    newId: Effect.sync(() => {
      const id = `00000000-0000-0000-0000-${String(next).padStart(12, "0")}`;
      next += 1;
      return id;
    }),
    now: () => clock,
  });
  return {
    service,
    store,
    created,
    prompted,
    setNow: (iso: string) => {
      clock = Date.parse(iso);
    },
  };
}

describe("ScheduleService", () => {
  it("creates a cron schedule with a future nextRunAt", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    expect(created.name).toBe("Morning review");
    expect(created.enabled).toBe(true);
    expect(created.nextRunAt).toBeTruthy();
    expect(Date.parse(created.nextRunAt!)).toBeGreaterThan(Date.parse("2026-08-27T08:00:00.000Z"));
  });

  it("rejects an invalid cron expression", async () => {
    const h = setup();
    await expect(
      run(h.service.create(cronInput({ spec: { kind: "cron", expr: "not-a-cron" } }))),
    ).rejects.toMatchObject({ _tag: "InvalidSchedule" });
  });

  it("runNow creates a session and records a started run", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const fired = await run(h.service.runNow(created.id));
    expect(h.created).toEqual([
      { projectId: PROJECT_ID, title: "Morning review", scheduleId: created.id },
    ]);
    expect(h.prompted).toEqual([{ projectId: PROJECT_ID, sessionId: "sess-1" }]);
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-1" });
    expect(fired.schedule.lastRunStatus).toBe("started");
    expect(fired.schedule.runs[0]?.reason).toBe("manual");
  });

  it("tick fires a due schedule and advances nextRunAt", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "* * * * *" } })),
    );
    const firstNext = created.nextRunAt!;
    h.setNow(firstNext);
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(1);
    expect(after?.lastRunStatus).toBe("started");
    expect(after?.runs[0]?.reason).toBe("scheduled");
    expect(after?.nextRunAt).not.toBe(firstNext);
    expect(Date.parse(after!.nextRunAt!)).toBeGreaterThan(Date.parse(firstNext));
  });

  it("tick skips a live previous session", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "* * * * *" } })),
    );
    const first = await run(h.service.runNow(created.id));
    expect(first.schedule.lastSessionId).toBe("sess-1");
    h.setNow(first.schedule.nextRunAt!);
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(1);
    expect(after?.lastRunStatus).toBe("skipped");
    expect(after?.runs[0]?.skipReason).toBe("in_progress");
  });

  it("disables a one-shot after it fires", async () => {
    const h = setup();
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "once", runAt: "2026-08-27T09:00:00.000Z" },
        }),
      ),
    );
    expect(created.enabled).toBe(true);
    h.setNow("2026-08-27T09:00:00.000Z");
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(after?.enabled).toBe(false);
    expect(after?.nextRunAt).toBeNull();
    expect(h.created).toHaveLength(1);
  });

  it("does not fire a paused schedule", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "* * * * *" }, enabled: false })),
    );
    h.setNow(created.nextRunAt ?? "2026-08-27T09:00:00.000Z");
    await run(h.service.tick());
    expect(h.created).toHaveLength(0);
  });

  it("skips a missed run older than seven days and reschedules", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "0 9 * * *" } })),
    );
    h.setNow("2026-09-10T09:00:00.000Z");
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(0);
    expect(after?.lastRunStatus).toBe("skipped");
    expect(after?.runs[0]?.skipReason).toBe("stale");
    expect(after?.nextRunAt).toBeTruthy();
    expect(Date.parse(after!.nextRunAt!)).toBeGreaterThan(Date.parse("2026-09-10T09:00:00.000Z"));
  });

  it("skips runNow when the project is gone", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const later = setup({ missingProject: true });
    later.store.set(created.id, created);
    const fired = await run(later.service.runNow(created.id));
    expect(fired.schedule.lastRunStatus).toBe("skipped");
    expect(fired.schedule.runs[0]?.skipReason).toBe("project_missing");
  });

  it("rejects a one-shot in the past", async () => {
    const h = setup();
    await expect(
      run(
        h.service.create(cronInput({ spec: { kind: "once", runAt: "2026-08-01T09:00:00.000Z" } })),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidSchedule" });
  });

  it("surfaces a write failure", async () => {
    const failing = makeScheduleService({
      repo: {
        ...memoryStore(),
        write: () =>
          Effect.fail(new StoreWriteError({ file: "schedules", cause: new Error("full") })),
      },
      projects: {
        findById: () => Effect.succeed({ path: "/tmp/app" }),
      },
      sessions: {
        create: () => Effect.die("unused"),
        prompt: () => Effect.die("unused"),
        getStatus: () => Effect.succeed({ phase: "idle" }),
      },
      newId: Effect.succeed("00000000-0000-0000-0000-000000000099"),
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    await expect(Effect.runPromise(failing.create(cronInput()))).rejects.toMatchObject({
      _tag: "StoreWriteError",
    });
  });
});
