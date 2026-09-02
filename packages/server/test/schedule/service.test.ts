import type { CreateScheduleInput, Schedule, SessionPhase, SessionRef } from "@getpie/contract";
import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectNotFound, ScheduleNotFound, StoreWriteError } from "../../src/errors";
import * as Observability from "../../src/observability";
import {
  makeScheduleService,
  type ScheduleSessions,
  type ScheduleStore,
} from "../../src/schedule/service";
import { structured, type LogRecord } from "../log-record";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const cronInput = (overrides: Partial<CreateScheduleInput> = {}): CreateScheduleInput => ({
  name: "Morning review",
  projectId: PROJECT_ID,
  prompt: "Review yesterday's commits.",
  spec: { kind: "cron", expr: "0 9 * * *" },
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(Observability.discard)));

const captureLogs = <A, E>(
  effect: Effect.Effect<A, E>,
  into: Array<LogRecord>,
): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.provide(
      Logger.layer([
        Logger.map(structured, (record) => {
          into.push(record);
        }),
      ]),
    ),
  );

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

function idleSessions(overrides: Partial<ScheduleSessions> = {}): ScheduleSessions {
  return {
    create: (input) =>
      Effect.succeed({
        ref: { projectId: input.projectId, sessionId: "sess-1" },
        workspace: { cwd: input.cwd },
      }),
    prompt: () => Effect.succeed({ turnId: "turn-1" }),
    getStatus: () => Effect.succeed({ phase: "idle" }),
    find: () => Effect.succeed({ archived: false }),
    waitUntilSettled: () => Effect.succeed({ phase: "idle" }),
    ...overrides,
  };
}

function setup(
  opts: {
    readonly live?: boolean;
    readonly sessionPhase?: (ref: SessionRef) => SessionPhase;
    readonly missingProject?: boolean;
    readonly sessions?: Partial<ScheduleSessions>;
    readonly forkSettle?: (effect: Effect.Effect<void>) => Effect.Effect<void>;
  } = {},
) {
  const store = new Map<string, Schedule>();
  let next = 1;
  let clock = Date.parse("2026-08-27T08:00:00.000Z");
  const created: Array<{ title?: string; projectId: string }> = [];
  const prompted: Array<string> = [];
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
  const sessions = idleSessions({
    create: (input) =>
      Effect.sync(() => {
        created.push({
          projectId: input.projectId,
          ...(input.title !== undefined ? { title: input.title } : undefined),
        });
        return {
          ref: { projectId: input.projectId, sessionId: `sess-${created.length}` },
          workspace: { cwd: input.cwd },
        };
      }),
    prompt: (input) =>
      Effect.sync(() => {
        const text = input.parts[0]?.type === "text" ? input.parts[0].text : "";
        prompted.push(text);
        return { turnId: `turn-${prompted.length}` };
      }),
    getStatus: (ref) =>
      Effect.succeed({
        phase: opts.sessionPhase?.(ref) ?? (opts.live === true ? "running" : "idle"),
      }),
    ...opts.sessions,
  });
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
    forkSettle: opts.forkSettle ?? ((effect) => effect),
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

  it("creates an interval schedule at now + everyMs", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "every", everyMs: 60_000 } })),
    );
    expect(created.nextRunAt).toBe("2026-08-27T08:01:00.000Z");
  });

  it("rejects an invalid cron expression", async () => {
    const h = setup();
    await expect(
      run(h.service.create(cronInput({ spec: { kind: "cron", expr: "not-a-cron" } }))),
    ).rejects.toMatchObject({ _tag: "InvalidSchedule" });
  });

  it("runNow creates a session, snapshots the prompt, then settles succeeded", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const fired = await run(h.service.runNow(created.id));
    expect(h.created).toEqual([{ projectId: PROJECT_ID, title: "Morning review" }]);
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-1" });
    expect(fired.schedule.lastRunStatus).toBe("running");
    expect(fired.schedule.lastSessionId).toBe("sess-1");
    expect(fired.schedule.runs[0]?.reason).toBe("manual");
    expect(fired.schedule.runs[0]?.sessionId).toBe("sess-1");
    expect(fired.schedule.runs[0]?.snapshot?.prompt).toBe("Review yesterday's commits.");
    const stored = h.store.get(created.id);
    expect(stored?.lastRunStatus).toBe("succeeded");
    expect(stored?.runs[0]?.status).toBe("succeeded");
    expect(stored?.lastSessionId).toBe("sess-1");
    expect(h.prompted).toEqual(["Review yesterday's commits."]);
  });

  it("keeps the fired snapshot after the live prompt changes", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ prompt: "first prompt" })));
    await run(h.service.runNow(created.id));
    await run(h.service.update({ id: created.id, prompt: "second prompt" }));
    const stored = h.store.get(created.id);
    expect(stored?.prompt).toBe("second prompt");
    expect(stored?.runs[0]?.snapshot?.prompt).toBe("first prompt");
  });

  it("runNow returns after create even if prompt never settles", async () => {
    const hanging = makeScheduleService({
      repo: memoryStore(),
      projects: {
        findById: () => Effect.succeed({ path: "/tmp/app" }),
      },
      sessions: idleSessions({
        create: (input) =>
          Effect.succeed({
            ref: { projectId: input.projectId, sessionId: "sess-hang" },
            workspace: { cwd: input.cwd },
          }),
        prompt: () => Effect.never,
      }),
      newId: Effect.succeed("00000000-0000-0000-0000-000000000088"),
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    const created = await run(hanging.create(cronInput()));
    const fired = await run(hanging.runNow(created.id));
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-hang" });
    expect(fired.schedule.lastRunStatus).toBe("running");
  });

  it("records queue overflow when a run is already in flight", async () => {
    let next = 1;
    const store = new Map<string, Schedule>();
    const hanging = makeScheduleService({
      repo: {
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
      },
      projects: {
        findById: () => Effect.succeed({ path: "/tmp/app" }),
      },
      sessions: idleSessions({
        prompt: () => Effect.never,
      }),
      newId: Effect.sync(() => {
        const id = `00000000-0000-0000-0000-${String(next).padStart(12, "0")}`;
        next += 1;
        return id;
      }),
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    const created = await run(hanging.create(cronInput()));
    await run(hanging.runNow(created.id));
    const overflow = await run(hanging.runNow(created.id));
    expect(overflow.schedule.lastRunStatus).toBe("missed");
    expect(overflow.schedule.runs[0]?.skipReason).toBe("queue_overflow");
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
    expect(after?.lastRunStatus).toBe("succeeded");
    expect(after?.runs[0]?.reason).toBe("scheduled");
    expect(after?.nextRunAt).not.toBe(firstNext);
    expect(Date.parse(after!.nextRunAt!)).toBeGreaterThan(Date.parse(firstNext));
  });

  it("skips a scheduled fire when the bound session is busy", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          session: { policy: "existing", sessionId: "picked" },
        }),
      ),
    );
    h.setNow(created.nextRunAt!);
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(0);
    expect(after?.lastRunStatus).toBe("skipped");
    expect(after?.runs[0]?.skipReason).toBe("in_progress");
  });

  it("skips runNow when the bound session is busy", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "manual" },
          session: { policy: "owned", sessionId: "owned-1" },
        }),
      ),
    );
    const fired = await run(h.service.runNow(created.id));
    expect(fired.ref).toBeUndefined();
    expect(h.created).toHaveLength(0);
    expect(fired.schedule.lastRunStatus).toBe("skipped");
    expect(fired.schedule.runs[0]?.skipReason).toBe("in_progress");
  });

  it("skips create runNow when the bound session is busy", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "manual" },
          session: { policy: "existing", sessionId: "picked" },
          runNow: true,
        }),
      ),
    );
    expect(h.created).toHaveLength(0);
    expect(created.lastRunStatus).toBe("skipped");
    expect(created.runs[0]?.skipReason).toBe("in_progress");
  });

  it("fires an isolated scheduled run even when the last session is still live", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "* * * * *" } })),
    );
    const first = await run(h.service.runNow(created.id));
    expect(first.schedule.lastSessionId).toBe("sess-1");
    h.setNow(first.schedule.nextRunAt!);
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(2);
    expect(after?.lastRunStatus).toBe("succeeded");
    expect(after?.lastSessionId).toBe("sess-2");
  });

  it("creates a session for owned-without-id even when lastSessionId is live", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(cronInput({ session: { policy: "owned" }, spec: { kind: "manual" } })),
    );
    h.store.set(created.id, {
      ...created,
      lastSessionId: "old-live",
      lastRunStatus: "succeeded",
    });
    const fired = await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(1);
    expect(fired.ref?.sessionId).toBe("sess-1");
    expect(h.store.get(created.id)?.session).toEqual({ policy: "owned", sessionId: "sess-1" });
  });

  it("skips a second schedule when they share a busy session", async () => {
    const phases = new Map<string, SessionPhase>([["shared", "idle"]]);
    const h = setup({
      sessionPhase: (ref) => phases.get(ref.sessionId) ?? "idle",
    });
    const first = await run(
      h.service.create(
        cronInput({
          name: "First",
          session: { policy: "existing", sessionId: "shared" },
          spec: { kind: "manual" },
        }),
      ),
    );
    const second = await run(
      h.service.create(
        cronInput({
          name: "Second",
          session: { policy: "existing", sessionId: "shared" },
          spec: { kind: "manual" },
        }),
      ),
    );
    const fired = await run(h.service.runNow(first.id));
    expect(fired.ref?.sessionId).toBe("shared");
    phases.set("shared", "running");
    const skipped = await run(h.service.runNow(second.id));
    expect(skipped.ref).toBeUndefined();
    expect(skipped.schedule.lastRunStatus).toBe("skipped");
    expect(skipped.schedule.runs[0]?.skipReason).toBe("in_progress");
  });

  it("records one missed run then fires a single recovery when late", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "every", everyMs: 60_000 } })),
    );
    h.setNow("2026-08-27T08:03:30.000Z");
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(1);
    expect(after?.runs[0]?.reason).toBe("missed_recovery");
    expect(after?.runs[0]?.status).toBe("succeeded");
    expect(after?.runs[1]?.status).toBe("missed");
    expect(after?.runs[1]?.missedCount).toBe(2);
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

  it("records a stale miss without creating a session", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "0 9 * * *" } })),
    );
    h.setNow("2026-09-10T09:00:00.000Z");
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(0);
    expect(after?.lastRunStatus).toBe("missed");
    expect(after?.runs[0]?.skipReason).toBe("stale");
    expect(after?.runs[0]?.missedCount).toBeGreaterThan(0);
    expect(after?.nextRunAt).toBeTruthy();
    expect(Date.parse(after!.nextRunAt!)).toBeGreaterThan(Date.parse("2026-09-10T09:00:00.000Z"));
  });

  it("expires an schedule that is past expiresAt", async () => {
    const h = setup();
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          expiresAt: "2026-08-27T08:30:00.000Z",
        }),
      ),
    );
    h.setNow("2026-08-27T08:30:00.000Z");
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(0);
    expect(after?.enabled).toBe(false);
    expect(after?.pauseReason).toBe("expired");
    expect(after?.lastRunStatus).toBe("skipped");
    expect(after?.runs[0]?.skipReason).toBe("expired");
  });

  it("reuses one session and creates again after archive", async () => {
    let archived = false;
    const h = setup({
      sessions: {
        find: () => Effect.succeed({ archived }),
      },
    });
    const created = await run(
      h.service.create(cronInput({ session: { policy: "owned" }, spec: { kind: "manual" } })),
    );
    await run(h.service.runNow(created.id));
    await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(1);
    expect(h.store.get(created.id)?.session).toEqual({ policy: "owned", sessionId: "sess-1" });
    archived = true;
    await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(2);
    expect(h.store.get(created.id)?.session).toEqual({ policy: "owned", sessionId: "sess-2" });
  });

  it("reuses a preselected session without creating first", async () => {
    const h = setup({
      sessions: {
        find: () => Effect.succeed({ archived: false }),
      },
    });
    const created = await run(
      h.service.create(
        cronInput({
          session: { policy: "existing", sessionId: "picked-session" },
          spec: { kind: "manual" },
        }),
      ),
    );
    await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(0);
    expect(h.store.get(created.id)?.session).toEqual({
      policy: "existing",
      sessionId: "picked-session",
    });
  });

  it("rejects a missing or archived reuse session on create", async () => {
    const missing = setup({
      sessions: { find: () => Effect.succeed(null) },
    });
    await expect(
      run(
        missing.service.create(
          cronInput({
            session: { policy: "existing", sessionId: "missing" },
            spec: { kind: "manual" },
          }),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidSchedule" });
    const archived = setup({
      sessions: { find: () => Effect.succeed({ archived: true }) },
    });
    await expect(
      run(
        archived.service.create(
          cronInput({
            session: { policy: "existing", sessionId: "old" },
            spec: { kind: "manual" },
          }),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidSchedule" });
  });

  it("opens the failure circuit after three settled failures", async () => {
    const h = setup({
      sessions: {
        prompt: () => Effect.fail(new Error("boom")),
      },
    });
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    await run(h.service.runNow(created.id));
    await run(h.service.runNow(created.id));
    expect(h.store.get(created.id)?.enabled).toBe(true);
    await run(h.service.runNow(created.id));
    const tripped = h.store.get(created.id);
    expect(tripped?.enabled).toBe(false);
    expect(tripped?.pauseReason).toBe("failureCircuit");
    expect(tripped?.consecutiveFailures).toBe(3);
    expect(tripped?.nextRunAt).toBeNull();
    const resumed = await run(h.service.update({ id: created.id, enabled: true }));
    expect(resumed.enabled).toBe(true);
    expect(resumed.pauseReason).toBeUndefined();
    expect(resumed.consecutiveFailures).toBe(0);
  });

  it("does not increment the circuit on capability-unavailable", async () => {
    const h = setup({
      sessions: {
        prompt: () => Effect.fail(new Error("capability-unavailable: no model")),
      },
    });
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    await run(h.service.runNow(created.id));
    const after = h.store.get(created.id);
    expect(after?.enabled).toBe(true);
    expect(after?.consecutiveFailures).toBe(0);
    expect(after?.lastRunStatus).toBe("failed");
  });

  it("caps the next wake delay at one minute", async () => {
    const h = setup();
    await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    await expect(run(h.service.nextWakeDelay())).resolves.toBe(60_000);
  });

  it("recovers leftover running runs as interrupted", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    h.store.set(created.id, {
      ...created,
      lastRunStatus: "running",
      runs: [
        {
          id: "run-live",
          startedAt: created.createdAt,
          reason: "scheduled",
          status: "running",
          sessionId: "sess-old",
        },
      ],
    });
    await run(h.service.recover());
    const after = h.store.get(created.id);
    expect(after?.lastRunStatus).toBe("interrupted");
    expect(after?.lastError).toBe("app-exit");
    expect(after?.runs[0]?.status).toBe("interrupted");
    expect(after?.runs[0]?.error).toBe("app-exit");
  });

  it("logs enable and pause", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    const records: Array<LogRecord> = [];
    await Effect.runPromise(
      captureLogs(h.service.update({ id: created.id, enabled: false }), records),
    );
    await Effect.runPromise(
      captureLogs(h.service.update({ id: created.id, enabled: true }), records),
    );
    expect(records.map((record) => record.annotations.event)).toEqual([
      "schedule.paused",
      "schedule.enabled",
    ]);
  });

  it("logs fire and settle bookends", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    const records: Array<LogRecord> = [];
    await Effect.runPromise(captureLogs(h.service.runNow(created.id), records));
    const events = records.map((record) => record.annotations.event);
    expect(events).toContain("schedule.fired");
    expect(events).toContain("schedule.settled");
  });

  it("skips runNow when the project is gone", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const later = setup({ missingProject: true });
    later.store.set(created.id, created);
    const fired = await run(later.service.runNow(created.id));
    expect(fired.schedule.lastRunStatus).toBe("skipped");
    expect(fired.schedule.runs[0]?.skipReason).toBe("project_missing");
    expect(fired.schedule.pauseReason).toBe("project_missing");
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
      sessions: idleSessions({
        create: () => Effect.die("unused"),
        prompt: () => Effect.die("unused"),
      }),
      newId: Effect.succeed("00000000-0000-0000-0000-000000000099"),
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
      forkSettle: (effect) => effect,
    });
    await expect(Effect.runPromise(failing.create(cronInput()))).rejects.toMatchObject({
      _tag: "StoreWriteError",
    });
  });

  it("create with runNow fires immediately and returns the session", async () => {
    const h = setup();
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "manual" }, runNow: true })),
    );
    expect(h.created).toEqual([{ projectId: PROJECT_ID, title: "Morning review" }]);
    expect(created.lastRunStatus).toBe("running");
    expect(created.lastSessionId).toBe("sess-1");
    expect(created.runs[0]?.reason).toBe("manual");
    expect(h.store.get(created.id)?.lastRunStatus).toBe("succeeded");
  });

  it("create without runNow does not start a session", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    expect(h.created).toHaveLength(0);
    expect(created.runs).toEqual([]);
    expect(created.lastSessionId).toBeUndefined();
  });

  it("pauses after reaching maxRuns and does not fire again", async () => {
    const h = setup();
    const created = await run(
      h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          maxRuns: 1,
        }),
      ),
    );
    h.setNow(created.nextRunAt!);
    await run(h.service.tick());
    const afterFire = h.store.get(created.id);
    expect(h.created).toHaveLength(1);
    expect(afterFire?.firedCount).toBe(1);
    expect(afterFire?.enabled).toBe(false);
    expect(afterFire?.pauseReason).toBe("max_runs");
    expect(afterFire?.nextRunAt).toBeNull();
    h.setNow("2026-08-27T09:00:00.000Z");
    await run(h.service.tick());
    expect(h.created).toHaveLength(1);
    const skipped = await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(1);
    expect(skipped.ref).toBeUndefined();
    expect(skipped.schedule.lastRunStatus).toBe("skipped");
    expect(skipped.schedule.runs[0]?.skipReason).toBe("max_runs");
  });

  it("pauses immediately when update sets maxRuns already reached", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    await run(h.service.runNow(created.id));
    const capped = await run(h.service.update({ id: created.id, maxRuns: 1 }));
    expect(capped.enabled).toBe(false);
    expect(capped.pauseReason).toBe("max_runs");
    expect(capped.maxRuns).toBe(1);
    const raised = await run(h.service.update({ id: created.id, maxRuns: 2, enabled: true }));
    expect(raised.enabled).toBe(true);
    expect(raised.pauseReason).toBeUndefined();
    expect(raised.maxRuns).toBe(2);
  });
});
