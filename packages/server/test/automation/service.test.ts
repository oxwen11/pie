import type { CreateAutomationInput, Automation } from "@getpie/contract";
import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeAutomationService,
  type AutomationSessions,
  type AutomationStore,
} from "../../src/automation/service";
import { ProjectNotFound, AutomationNotFound, StoreWriteError } from "../../src/errors";
import * as Observability from "../../src/observability";
import { structured, type LogRecord } from "../log-record";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const cronInput = (overrides: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
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

function memoryStore(initial: ReadonlyArray<Automation> = []): AutomationStore {
  const store = new Map<string, Automation>(
    initial.map((automation) => [automation.id, automation]),
  );
  return {
    list: () => Effect.succeed(Array.from(store.values())),
    read: (id) => {
      const found = store.get(id);
      return found === undefined
        ? Effect.fail(new AutomationNotFound({ automationId: id }))
        : Effect.succeed(found);
    },
    write: (automation) =>
      Effect.sync(() => {
        store.set(automation.id, automation);
      }),
    remove: (id) =>
      Effect.sync(() => {
        store.delete(id);
      }),
  };
}

function idleSessions(overrides: Partial<AutomationSessions> = {}): AutomationSessions {
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
    readonly missingProject?: boolean;
    readonly sessions?: Partial<AutomationSessions>;
    readonly forkSettle?: (effect: Effect.Effect<void>) => Effect.Effect<void>;
  } = {},
) {
  const store = new Map<string, Automation>();
  let next = 1;
  let clock = Date.parse("2026-08-27T08:00:00.000Z");
  const created: Array<{ title?: string; projectId: string }> = [];
  const prompted: Array<string> = [];
  const repo: AutomationStore = {
    list: () => Effect.succeed(Array.from(store.values())),
    read: (id) => {
      const found = store.get(id);
      return found === undefined
        ? Effect.fail(new AutomationNotFound({ automationId: id }))
        : Effect.succeed(found);
    },
    write: (automation) =>
      Effect.sync(() => {
        store.set(automation.id, automation);
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
    getStatus: () => Effect.succeed({ phase: opts.live === true ? "running" : "idle" }),
    ...opts.sessions,
  });
  const service = makeAutomationService({
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

describe("AutomationService", () => {
  it("creates a cron automation with a future nextRunAt", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    expect(created.name).toBe("Morning review");
    expect(created.enabled).toBe(true);
    expect(created.nextRunAt).toBeTruthy();
    expect(Date.parse(created.nextRunAt!)).toBeGreaterThan(Date.parse("2026-08-27T08:00:00.000Z"));
  });

  it("creates an interval automation at now + everyMs", async () => {
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
    ).rejects.toMatchObject({ _tag: "InvalidAutomation" });
  });

  it("runNow creates a session, snapshots the prompt, then settles succeeded", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const fired = await run(h.service.runNow(created.id));
    expect(h.created).toEqual([{ projectId: PROJECT_ID, title: "Morning review" }]);
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-1" });
    expect(fired.automation.lastRunStatus).toBe("running");
    expect(fired.automation.lastSessionId).toBe("sess-1");
    expect(fired.automation.runs[0]?.reason).toBe("manual");
    expect(fired.automation.runs[0]?.sessionId).toBe("sess-1");
    expect(fired.automation.runs[0]?.snapshot?.prompt).toBe("Review yesterday's commits.");
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
    const hanging = makeAutomationService({
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
    expect(fired.automation.lastRunStatus).toBe("running");
  });

  it("records queue overflow when a run is already in flight", async () => {
    let next = 1;
    const store = new Map<string, Automation>();
    const hanging = makeAutomationService({
      repo: {
        list: () => Effect.succeed(Array.from(store.values())),
        read: (id) => {
          const found = store.get(id);
          return found === undefined
            ? Effect.fail(new AutomationNotFound({ automationId: id }))
            : Effect.succeed(found);
        },
        write: (automation) =>
          Effect.sync(() => {
            store.set(automation.id, automation);
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
    expect(overflow.automation.lastRunStatus).toBe("missed");
    expect(overflow.automation.runs[0]?.skipReason).toBe("queue_overflow");
  });

  it("tick fires a due automation and advances nextRunAt", async () => {
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

  it("tick skips a live previous session", async () => {
    const h = setup({ live: true });
    const created = await run(
      h.service.create(cronInput({ spec: { kind: "cron", expr: "* * * * *" } })),
    );
    const first = await run(h.service.runNow(created.id));
    expect(first.automation.lastSessionId).toBe("sess-1");
    h.setNow(first.automation.nextRunAt!);
    await run(h.service.tick());
    const after = h.store.get(created.id);
    expect(h.created).toHaveLength(1);
    expect(after?.lastRunStatus).toBe("skipped");
    expect(after?.runs[0]?.skipReason).toBe("in_progress");
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

  it("does not fire a paused automation", async () => {
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

  it("expires an automation that is past expiresAt", async () => {
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

  it("reuses one session in merged mode and creates again after archive", async () => {
    let archived = false;
    const h = setup({
      sessions: {
        find: () => Effect.succeed({ archived }),
      },
    });
    const created = await run(
      h.service.create(cronInput({ outputMode: "merged", spec: { kind: "manual" } })),
    );
    await run(h.service.runNow(created.id));
    await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(1);
    expect(h.store.get(created.id)?.mergedSessionId).toBe("sess-1");
    archived = true;
    await run(h.service.runNow(created.id));
    expect(h.created).toHaveLength(2);
    expect(h.store.get(created.id)?.mergedSessionId).toBe("sess-2");
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
      "automation.paused",
      "automation.enabled",
    ]);
  });

  it("logs fire and settle bookends", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput({ spec: { kind: "manual" } })));
    const records: Array<LogRecord> = [];
    await Effect.runPromise(captureLogs(h.service.runNow(created.id), records));
    const events = records.map((record) => record.annotations.event);
    expect(events).toContain("automation.fired");
    expect(events).toContain("automation.settled");
  });

  it("skips runNow when the project is gone", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const later = setup({ missingProject: true });
    later.store.set(created.id, created);
    const fired = await run(later.service.runNow(created.id));
    expect(fired.automation.lastRunStatus).toBe("skipped");
    expect(fired.automation.runs[0]?.skipReason).toBe("project_missing");
    expect(fired.automation.pauseReason).toBe("project_missing");
  });

  it("rejects a one-shot in the past", async () => {
    const h = setup();
    await expect(
      run(
        h.service.create(cronInput({ spec: { kind: "once", runAt: "2026-08-01T09:00:00.000Z" } })),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidAutomation" });
  });

  it("surfaces a write failure", async () => {
    const failing = makeAutomationService({
      repo: {
        ...memoryStore(),
        write: () =>
          Effect.fail(new StoreWriteError({ file: "automations", cause: new Error("full") })),
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
});
