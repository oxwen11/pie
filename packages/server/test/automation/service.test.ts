import type { CreateAutomationInput, Automation } from "@getpie/contract";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeAutomationService,
  type AutomationSessions,
  type AutomationStore,
} from "../../src/automation/service";
import { ProjectNotFound, AutomationNotFound, StoreWriteError } from "../../src/errors";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const cronInput = (overrides: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: "Morning review",
  projectId: PROJECT_ID,
  prompt: "Review yesterday's commits.",
  spec: { kind: "cron", expr: "0 9 * * *" },
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

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

function setup(opts: { readonly live?: boolean; readonly missingProject?: boolean } = {}) {
  const store = new Map<string, Automation>();
  let next = 1;
  let clock = Date.parse("2026-08-27T08:00:00.000Z");
  const created: Array<{ title?: string; automationId?: string; projectId: string }> = [];
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
  const sessions: AutomationSessions = {
    create: (input) =>
      Effect.sync(() => {
        created.push({
          projectId: input.projectId,
          ...(input.title !== undefined ? { title: input.title } : undefined),
          ...(input.automationId !== undefined ? { automationId: input.automationId } : undefined),
        });
        return {
          ref: { projectId: input.projectId, sessionId: `sess-${created.length}` },
          workspace: { cwd: input.cwd },
        };
      }),
    prompt: () => Effect.succeed({ turnId: "turn-1" }),
    getStatus: () => Effect.succeed({ phase: opts.live === true ? "running" : "idle" }),
  };
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
  });
  return {
    service,
    store,
    created,
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

  it("rejects an invalid cron expression", async () => {
    const h = setup();
    await expect(
      run(h.service.create(cronInput({ spec: { kind: "cron", expr: "not-a-cron" } }))),
    ).rejects.toMatchObject({ _tag: "InvalidAutomation" });
  });

  it("runNow creates a session and records a started run", async () => {
    const h = setup();
    const created = await run(h.service.create(cronInput()));
    const fired = await run(h.service.runNow(created.id));
    expect(h.created).toEqual([
      { projectId: PROJECT_ID, title: "Morning review", automationId: created.id },
    ]);
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-1" });
    expect(fired.automation.lastRunStatus).toBe("started");
    expect(fired.automation.runs[0]?.reason).toBe("manual");
  });

  it("runNow returns after create even if prompt never settles", async () => {
    const hanging = makeAutomationService({
      repo: memoryStore(),
      projects: {
        findById: () => Effect.succeed({ path: "/tmp/app" }),
      },
      sessions: {
        create: (input) =>
          Effect.succeed({
            ref: { projectId: input.projectId, sessionId: "sess-hang" },
            workspace: { cwd: input.cwd },
          }),
        prompt: () => Effect.never,
        getStatus: () => Effect.succeed({ phase: "idle" }),
      },
      newId: Effect.succeed("00000000-0000-0000-0000-000000000088"),
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    const created = await run(hanging.create(cronInput()));
    const fired = await run(hanging.runNow(created.id));
    expect(fired.ref).toEqual({ projectId: PROJECT_ID, sessionId: "sess-hang" });
    expect(fired.automation.lastRunStatus).toBe("started");
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
    expect(first.automation.lastSessionId).toBe("sess-1");
    h.setNow(first.automation.nextRunAt!);
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

  it("does not fire a paused automation", async () => {
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
    expect(fired.automation.lastRunStatus).toBe("skipped");
    expect(fired.automation.runs[0]?.skipReason).toBe("project_missing");
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
