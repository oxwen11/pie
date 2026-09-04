import { assert, describe, it } from "@effect/vitest";
import type {
  CreateScheduleInput,
  Schedule,
  SessionPhase,
  SessionRef,
  SessionSummary,
} from "@getpie/contract";
import { CAPABILITY_UNAVAILABLE_TAG } from "@getpie/contract";
import { Context, Effect, Fiber, Layer, Logger } from "effect";
import { TestClock } from "effect/testing";

import { ProjectNotFound, ScheduleNotFound, StoreWriteError } from "../../src/errors";
import { PiAgentSessionService, type PiAgentSessionServiceShape } from "../../src/harness";
import { ProjectService } from "../../src/project";
import { runScheduleLoop } from "../../src/schedule/daemon";
import { ScheduleRepository } from "../../src/schedule/repository";
import { ScheduleService, ScheduleServiceLayer } from "../../src/schedule/service";
import { structured, type LogRecord } from "../log-record";
import { NodePlatformLayer } from "../platform";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORIGIN = Date.parse("2026-08-27T08:00:00.000Z");
const ORIGIN_ISO = "2026-08-27T08:00:00.000Z";

const cronInput = (overrides: Partial<CreateScheduleInput> = {}): CreateScheduleInput => ({
  name: "Morning review",
  projectId: PROJECT_ID,
  prompt: "Review yesterday's commits.",
  spec: { kind: "cron", expr: "0 9 * * *" },
  ...overrides,
});

const unused = (): Effect.Effect<never> => Effect.die("unused");

const captureLogs = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  into: Array<LogRecord>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provide(
      Logger.layer([
        Logger.map(structured, (record) => {
          into.push(record);
        }),
      ]),
    ),
  );

const memoryRepo = (
  store: Map<string, Schedule>,
  write: ScheduleRepository["Service"]["write"] = (schedule) =>
    Effect.sync(() => {
      store.set(schedule.id, schedule);
    }),
): ScheduleRepository["Service"] => ({
  list: () => Effect.succeed(Array.from(store.values())),
  read: (id) => {
    const found = store.get(id);
    return found === undefined
      ? Effect.fail(new ScheduleNotFound({ scheduleId: id }))
      : Effect.succeed(found);
  },
  write,
  remove: (id) =>
    Effect.sync(() => {
      store.delete(id);
    }),
});

const stubProjects = (missingProject: boolean): ProjectService["Service"] => ({
  list: unused,
  findById: (id) =>
    missingProject || id !== PROJECT_ID
      ? Effect.fail(new ProjectNotFound({ projectId: id }))
      : Effect.succeed({
          id,
          name: "app",
          path: "/tmp/app",
          createdAt: ORIGIN_ISO,
        }),
  findByPath: unused,
  create: unused,
  remove: unused,
});

type SessionRecord = {
  readonly projectId: string;
  readonly sessionId: string;
  archived: boolean;
};

const stubSessions = (opts: {
  readonly created: Array<{ title?: string; projectId: string }>;
  readonly prompted: Array<string>;
  readonly catalog: Array<SessionRecord>;
  readonly sessionPhase?: (ref: SessionRef) => SessionPhase;
  readonly live?: boolean;
  readonly prompt?: (
    input: Parameters<PiAgentSessionServiceShape["prompt"]>[0],
  ) => Effect.Effect<{ readonly turnId: string; readonly started: boolean }, unknown>;
}): PiAgentSessionServiceShape => {
  const summary = (session: SessionRecord): SessionSummary => ({
    projectId: session.projectId,
    sessionId: session.sessionId,
    archived: session.archived,
    createdAt: ORIGIN_ISO,
    historyAvailable: false,
  });
  return {
    create: (input) =>
      Effect.sync(() => {
        opts.created.push({
          projectId: input.projectId,
          ...(input.title !== undefined ? { title: input.title } : undefined),
        });
        const sessionId = `sess-${opts.created.length}`;
        opts.catalog.push({ projectId: input.projectId, sessionId, archived: false });
        return {
          ref: { projectId: input.projectId, sessionId },
          workspace: { cwd: input.cwd },
        };
      }),
    prompt: (opts.prompt ??
      ((input) =>
        Effect.sync(() => {
          const text = input.parts[0]?.type === "text" ? input.parts[0].text : "";
          opts.prompted.push(text);
          return { turnId: `turn-${opts.prompted.length}`, started: true };
        }))) as PiAgentSessionServiceShape["prompt"],
    getStatus: (ref) =>
      Effect.succeed({
        phase: opts.sessionPhase?.(ref) ?? (opts.live === true ? "running" : "idle"),
      }),
    list: (projectId, archived) =>
      Effect.succeed(
        opts.catalog
          .filter((session) => session.projectId === projectId && session.archived === archived)
          .map(summary),
      ),
    prepare: unused,
    workspaceFor: unused,
    close: unused,
    delete: unused,
    rename: unused,
    archive: unused,
    pullRequestRefsFor: unused,
    rememberPullRequestRef: unused,
    getMessages: unused,
    interrupt: unused,
    replaceQueue: unused,
    respondToAgentRequest: unused,
    getCapabilities: unused,
    getModelState: unused,
    setModel: unused,
    getSessionInfo: unused,
    getSnapshot: unused,
    resolveRef: unused,
  };
};

const seedSession = (catalog: Array<SessionRecord>, sessionId: string, archived = false): void => {
  catalog.push({ projectId: PROJECT_ID, sessionId, archived });
};

const harness = (
  opts: {
    readonly live?: boolean;
    readonly sessionPhase?: (ref: SessionRef) => SessionPhase;
    readonly missingProject?: boolean;
    readonly writeFails?: boolean;
    readonly prompt?: (
      input: Parameters<PiAgentSessionServiceShape["prompt"]>[0],
    ) => Effect.Effect<{ readonly turnId: string; readonly started: boolean }, unknown>;
    readonly seed?: ReadonlyArray<{ readonly sessionId: string; readonly archived?: boolean }>;
  } = {},
) =>
  Effect.gen(function* () {
    const store = new Map<string, Schedule>();
    const created: Array<{ title?: string; projectId: string }> = [];
    const prompted: Array<string> = [];
    const catalog: Array<SessionRecord> = [];
    for (const session of opts.seed ?? []) {
      seedSession(catalog, session.sessionId, session.archived ?? false);
    }
    const context = yield* Layer.build(
      ScheduleServiceLayer.pipe(
        Layer.provide(
          Layer.succeed(
            ScheduleRepository,
            memoryRepo(
              store,
              opts.writeFails === true
                ? () =>
                    Effect.fail(
                      new StoreWriteError({ file: "schedules", cause: new Error("full") }),
                    )
                : undefined,
            ),
          ),
        ),
        Layer.provide(Layer.succeed(ProjectService, stubProjects(opts.missingProject === true))),
        Layer.provide(
          Layer.succeed(
            PiAgentSessionService,
            stubSessions({
              created,
              prompted,
              catalog,
              ...(opts.sessionPhase !== undefined
                ? { sessionPhase: opts.sessionPhase }
                : undefined),
              ...(opts.live === true ? { live: true } : undefined),
              ...(opts.prompt !== undefined ? { prompt: opts.prompt } : undefined),
            }),
          ),
        ),
        Layer.provide(NodePlatformLayer),
      ),
    );
    return {
      service: Context.get(context, ScheduleService),
      store,
      created,
      prompted,
      catalog,
    };
  });

describe("ScheduleService", () => {
  it.effect("creates a cron schedule with a future nextRunAt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput());
      assert.strictEqual(created.name, "Morning review");
      assert.strictEqual(created.enabled, true);
      assert.isTrue(created.nextRunAt !== null);
      assert.isTrue(Date.parse(created.nextRunAt!) > ORIGIN);
    }),
  );

  it.effect("creates an interval schedule at now + everyMs", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "every", everyMs: 60_000 } }),
      );
      assert.strictEqual(created.nextRunAt, "2026-08-27T08:01:00.000Z");
    }),
  );

  it.effect("rejects an invalid cron expression", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const error = yield* Effect.flip(
        h.service.create(cronInput({ spec: { kind: "cron", expr: "not-a-cron" } })),
      );
      assert.strictEqual(error._tag, "InvalidSchedule");
    }),
  );

  it.effect("runNow creates a session, snapshots the prompt, then settles succeeded", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput());
      const fired = yield* h.service.runNow(created.id);
      assert.deepStrictEqual(h.created, [{ projectId: PROJECT_ID, title: "Morning review" }]);
      assert.deepStrictEqual(fired.ref, { projectId: PROJECT_ID, sessionId: "sess-1" });
      assert.strictEqual(fired.schedule.lastRunStatus, "running");
      assert.strictEqual(fired.schedule.lastSessionId, "sess-1");
      assert.strictEqual(fired.schedule.runs[0]?.reason, "manual");
      assert.strictEqual(fired.schedule.runs[0]?.sessionId, "sess-1");
      assert.strictEqual(fired.schedule.runs[0]?.snapshot?.prompt, "Review yesterday's commits.");
      yield* Effect.yieldNow;
      const stored = h.store.get(created.id);
      assert.strictEqual(stored?.lastRunStatus, "succeeded");
      assert.strictEqual(stored?.runs[0]?.status, "succeeded");
      assert.strictEqual(stored?.lastSessionId, "sess-1");
      assert.deepStrictEqual(h.prompted, ["Review yesterday's commits."]);
    }),
  );

  it.effect("keeps the fired snapshot after the live prompt changes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ prompt: "first prompt" }));
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      yield* h.service.update({ id: created.id, prompt: "second prompt" });
      const stored = h.store.get(created.id);
      assert.strictEqual(stored?.prompt, "second prompt");
      assert.strictEqual(stored?.runs[0]?.snapshot?.prompt, "first prompt");
    }),
  );

  it.effect("stores the chosen model and updates it", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
      );
      assert.strictEqual(h.store.get(created.id)?.provider, "anthropic");
      assert.strictEqual(h.store.get(created.id)?.modelId, "claude-sonnet-4-5");
      const changed = yield* h.service.update({
        id: created.id,
        provider: "openai",
        modelId: "gpt-5",
      });
      assert.strictEqual(changed.provider, "openai");
      assert.strictEqual(changed.modelId, "gpt-5");
    }),
  );

  it.effect("settles a still-running session after TestClock advances the poll", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      let phase: SessionPhase = "running";
      const h = yield* harness({ sessionPhase: () => phase });
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      yield* h.service.runNow(created.id);
      assert.strictEqual(h.store.get(created.id)?.lastRunStatus, "running");
      phase = "idle";
      yield* TestClock.adjust("200 millis");
      yield* Effect.yieldNow;
      assert.strictEqual(h.store.get(created.id)?.lastRunStatus, "succeeded");
    }),
  );

  it.effect("runNow returns after create even if prompt never settles", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({ prompt: () => Effect.never });
      const created = yield* h.service.create(cronInput());
      const fired = yield* h.service.runNow(created.id);
      assert.deepStrictEqual(fired.ref, { projectId: PROJECT_ID, sessionId: "sess-1" });
      assert.strictEqual(fired.schedule.lastRunStatus, "running");
    }),
  );

  it.effect("records queue overflow when a run is already in flight", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({ prompt: () => Effect.never });
      const created = yield* h.service.create(cronInput());
      yield* h.service.runNow(created.id);
      const overflow = yield* h.service.runNow(created.id);
      assert.strictEqual(overflow.schedule.lastRunStatus, "missed");
      assert.strictEqual(overflow.schedule.runs[0]?.skipReason, "queue_overflow");
    }),
  );

  it.effect("tick fires a due schedule and advances nextRunAt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "cron", expr: "* * * * *" } }),
      );
      const firstNext = created.nextRunAt!;
      yield* TestClock.setTime(Date.parse(firstNext));
      yield* h.service.tick();
      yield* Effect.yieldNow;
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 1);
      assert.strictEqual(after?.lastRunStatus, "succeeded");
      assert.strictEqual(after?.runs[0]?.reason, "scheduled");
      assert.notStrictEqual(after?.nextRunAt, firstNext);
      assert.isTrue(Date.parse(after!.nextRunAt!) > Date.parse(firstNext));
    }),
  );

  it.effect("skips a scheduled fire when the bound session is busy", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({
        live: true,
        seed: [{ sessionId: "picked" }],
      });
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          session: { policy: "existing", sessionId: "picked" },
        }),
      );
      yield* TestClock.setTime(Date.parse(created.nextRunAt!));
      yield* h.service.tick();
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 0);
      assert.strictEqual(after?.lastRunStatus, "skipped");
      assert.strictEqual(after?.runs[0]?.skipReason, "in_progress");
    }),
  );

  it.effect("skips runNow when the bound session is busy", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({
        live: true,
        seed: [{ sessionId: "owned-1" }],
      });
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "manual" },
          session: { policy: "owned", sessionId: "owned-1" },
        }),
      );
      const fired = yield* h.service.runNow(created.id);
      assert.isUndefined(fired.ref);
      assert.strictEqual(h.created.length, 0);
      assert.strictEqual(fired.schedule.lastRunStatus, "skipped");
      assert.strictEqual(fired.schedule.runs[0]?.skipReason, "in_progress");
    }),
  );

  it.effect("skips create runNow when the bound session is busy", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({
        live: true,
        seed: [{ sessionId: "picked" }],
      });
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "manual" },
          session: { policy: "existing", sessionId: "picked" },
          runNow: true,
        }),
      );
      assert.strictEqual(h.created.length, 0);
      assert.strictEqual(created.lastRunStatus, "skipped");
      assert.strictEqual(created.runs[0]?.skipReason, "in_progress");
    }),
  );

  it.effect("fires an isolated scheduled run even when the last session is still live", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const live = new Set<string>();
      const h = yield* harness({
        sessionPhase: (ref) => (live.has(ref.sessionId) ? "running" : "idle"),
      });
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "cron", expr: "* * * * *" } }),
      );
      const first = yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      assert.strictEqual(first.schedule.lastSessionId, "sess-1");
      live.add("sess-1");
      yield* TestClock.setTime(Date.parse(first.schedule.nextRunAt!));
      yield* h.service.tick();
      yield* Effect.yieldNow;
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 2);
      assert.strictEqual(after?.lastRunStatus, "succeeded");
      assert.strictEqual(after?.lastSessionId, "sess-2");
    }),
  );

  it.effect("creates a session for owned-without-id even when lastSessionId is live", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({ live: true });
      const created = yield* h.service.create(
        cronInput({ session: { policy: "owned" }, spec: { kind: "manual" } }),
      );
      h.store.set(created.id, {
        ...created,
        lastSessionId: "old-live",
        lastRunStatus: "succeeded",
      });
      const fired = yield* h.service.runNow(created.id);
      assert.strictEqual(h.created.length, 1);
      assert.strictEqual(fired.ref?.sessionId, "sess-1");
      assert.deepStrictEqual(h.store.get(created.id)?.session, {
        policy: "owned",
        sessionId: "sess-1",
      });
    }),
  );

  it.effect("skips a second schedule when they share a busy session", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const phases = new Map<string, SessionPhase>([["shared", "idle"]]);
      const h = yield* harness({
        sessionPhase: (ref) => phases.get(ref.sessionId) ?? "idle",
        seed: [{ sessionId: "shared" }],
      });
      const first = yield* h.service.create(
        cronInput({
          name: "First",
          session: { policy: "existing", sessionId: "shared" },
          spec: { kind: "manual" },
        }),
      );
      const second = yield* h.service.create(
        cronInput({
          name: "Second",
          session: { policy: "existing", sessionId: "shared" },
          spec: { kind: "manual" },
        }),
      );
      const fired = yield* h.service.runNow(first.id);
      assert.strictEqual(fired.ref?.sessionId, "shared");
      phases.set("shared", "running");
      const skipped = yield* h.service.runNow(second.id);
      assert.isUndefined(skipped.ref);
      assert.strictEqual(skipped.schedule.lastRunStatus, "skipped");
      assert.strictEqual(skipped.schedule.runs[0]?.skipReason, "in_progress");
    }),
  );

  it.effect("records one missed run then fires a single recovery when late", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "every", everyMs: 60_000 } }),
      );
      yield* TestClock.setTime(Date.parse("2026-08-27T08:03:30.000Z"));
      yield* h.service.tick();
      yield* Effect.yieldNow;
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 1);
      assert.strictEqual(after?.runs[0]?.reason, "missed_recovery");
      assert.strictEqual(after?.runs[0]?.status, "succeeded");
      assert.strictEqual(after?.runs[1]?.status, "missed");
      assert.strictEqual(after?.runs[1]?.missedCount, 2);
    }),
  );

  it.effect("disables a one-shot after it fires", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "once", runAt: "2026-08-27T09:00:00.000Z" },
        }),
      );
      assert.strictEqual(created.enabled, true);
      yield* TestClock.setTime(Date.parse("2026-08-27T09:00:00.000Z"));
      yield* h.service.tick();
      yield* Effect.yieldNow;
      const after = h.store.get(created.id);
      assert.strictEqual(after?.enabled, false);
      assert.strictEqual(after?.nextRunAt, null);
      assert.strictEqual(h.created.length, 1);
    }),
  );

  it.effect("does not fire a paused schedule", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "cron", expr: "* * * * *" }, enabled: false }),
      );
      yield* TestClock.setTime(Date.parse(created.nextRunAt ?? "2026-08-27T09:00:00.000Z"));
      yield* h.service.tick();
      assert.strictEqual(h.created.length, 0);
    }),
  );

  it.effect("records a stale miss without creating a session", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "cron", expr: "0 9 * * *" } }),
      );
      yield* TestClock.setTime(Date.parse("2026-09-10T09:00:00.000Z"));
      yield* h.service.tick();
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 0);
      assert.strictEqual(after?.lastRunStatus, "missed");
      assert.strictEqual(after?.runs[0]?.skipReason, "stale");
      assert.isTrue((after?.runs[0]?.missedCount ?? 0) > 0);
      assert.isTrue(after?.nextRunAt !== null && after?.nextRunAt !== undefined);
      assert.isTrue(Date.parse(after!.nextRunAt!) > Date.parse("2026-09-10T09:00:00.000Z"));
    }),
  );

  it.effect("expires a schedule that is past expiresAt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          expiresAt: "2026-08-27T08:30:00.000Z",
        }),
      );
      yield* TestClock.setTime(Date.parse("2026-08-27T08:30:00.000Z"));
      yield* h.service.tick();
      const after = h.store.get(created.id);
      assert.strictEqual(h.created.length, 0);
      assert.strictEqual(after?.enabled, false);
      assert.strictEqual(after?.pauseReason, "expired");
      assert.strictEqual(after?.lastRunStatus, "skipped");
      assert.strictEqual(after?.runs[0]?.skipReason, "expired");
    }),
  );

  it.effect("reuses one session and creates again after archive", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ session: { policy: "owned" }, spec: { kind: "manual" } }),
      );
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      assert.strictEqual(h.created.length, 1);
      assert.deepStrictEqual(h.store.get(created.id)?.session, {
        policy: "owned",
        sessionId: "sess-1",
      });
      const bound = h.catalog.find((session) => session.sessionId === "sess-1");
      assert.isDefined(bound);
      bound!.archived = true;
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      assert.strictEqual(h.created.length, 2);
      assert.deepStrictEqual(h.store.get(created.id)?.session, {
        policy: "owned",
        sessionId: "sess-2",
      });
    }),
  );

  it.effect("reuses a preselected session without creating first", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({ seed: [{ sessionId: "picked-session" }] });
      const created = yield* h.service.create(
        cronInput({
          session: { policy: "existing", sessionId: "picked-session" },
          spec: { kind: "manual" },
        }),
      );
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      assert.strictEqual(h.created.length, 0);
      assert.deepStrictEqual(h.store.get(created.id)?.session, {
        policy: "existing",
        sessionId: "picked-session",
      });
    }),
  );

  it.effect("rejects a missing or archived reuse session on create", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const missing = yield* harness();
      const missingError = yield* Effect.flip(
        missing.service.create(
          cronInput({
            session: { policy: "existing", sessionId: "missing" },
            spec: { kind: "manual" },
          }),
        ),
      );
      assert.strictEqual(missingError._tag, "InvalidSchedule");
      const archived = yield* harness({ seed: [{ sessionId: "old", archived: true }] });
      const archivedError = yield* Effect.flip(
        archived.service.create(
          cronInput({
            session: { policy: "existing", sessionId: "old" },
            spec: { kind: "manual" },
          }),
        ),
      );
      assert.strictEqual(archivedError._tag, "InvalidSchedule");
    }),
  );

  it.effect("opens the failure circuit after three settled failures", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({
        prompt: () => Effect.fail(new Error("boom")),
      });
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      assert.strictEqual(h.store.get(created.id)?.enabled, true);
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      const tripped = h.store.get(created.id);
      assert.strictEqual(tripped?.enabled, false);
      assert.strictEqual(tripped?.pauseReason, "failureCircuit");
      assert.strictEqual(tripped?.consecutiveFailures, 3);
      assert.strictEqual(tripped?.nextRunAt, null);
      const resumed = yield* h.service.update({ id: created.id, enabled: true });
      assert.strictEqual(resumed.enabled, true);
      assert.isUndefined(resumed.pauseReason);
      assert.strictEqual(resumed.consecutiveFailures, 0);
    }),
  );

  it.effect("does not increment the circuit on capability-unavailable", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({
        prompt: () => Effect.fail(new Error(`${CAPABILITY_UNAVAILABLE_TAG}: no model`)),
      });
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      const after = h.store.get(created.id);
      assert.strictEqual(after?.enabled, true);
      assert.strictEqual(after?.consecutiveFailures, 0);
      assert.strictEqual(after?.lastRunStatus, "failed");
    }),
  );

  it.effect("caps the next wake delay at one minute", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      const delay = yield* h.service.nextWakeDelay();
      assert.strictEqual(delay, 60_000);
    }),
  );

  it.effect("recovers leftover running runs as interrupted", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
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
      yield* h.service.recover();
      const after = h.store.get(created.id);
      assert.strictEqual(after?.lastRunStatus, "interrupted");
      assert.strictEqual(after?.lastError, "app-exit");
      assert.strictEqual(after?.runs[0]?.status, "interrupted");
      assert.strictEqual(after?.runs[0]?.error, "app-exit");
    }),
  );

  it.effect("logs enable and pause", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      const records: Array<LogRecord> = [];
      yield* captureLogs(h.service.update({ id: created.id, enabled: false }), records);
      yield* captureLogs(h.service.update({ id: created.id, enabled: true }), records);
      assert.deepStrictEqual(
        records.map((record) => record.annotations.event),
        ["schedule.paused", "schedule.enabled"],
      );
    }),
  );

  it.effect("logs fire and settle bookends", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      const records: Array<LogRecord> = [];
      yield* captureLogs(h.service.runNow(created.id), records);
      yield* Effect.yieldNow;
      const events = new Set(records.map((record) => record.annotations.event));
      assert.isTrue(events.has("schedule.fired"));
      assert.isTrue(events.has("schedule.settled"));
    }),
  );

  it.effect("skips runNow when the project is gone", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput());
      const later = yield* harness({ missingProject: true });
      later.store.set(created.id, created);
      const fired = yield* later.service.runNow(created.id);
      assert.strictEqual(fired.schedule.lastRunStatus, "skipped");
      assert.strictEqual(fired.schedule.runs[0]?.skipReason, "project_missing");
      assert.strictEqual(fired.schedule.pauseReason, "project_missing");
    }),
  );

  it.effect("rejects a one-shot in the past", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const error = yield* Effect.flip(
        h.service.create(cronInput({ spec: { kind: "once", runAt: "2026-08-01T09:00:00.000Z" } })),
      );
      assert.strictEqual(error._tag, "InvalidSchedule");
    }),
  );

  it.effect("surfaces a write failure", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness({ writeFails: true });
      const error = yield* Effect.flip(h.service.create(cronInput()));
      assert.strictEqual(error._tag, "StoreWriteError");
    }),
  );

  it.effect("create with runNow fires immediately and returns the session", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({ spec: { kind: "manual" }, runNow: true }),
      );
      assert.deepStrictEqual(h.created, [{ projectId: PROJECT_ID, title: "Morning review" }]);
      assert.strictEqual(created.lastRunStatus, "running");
      assert.strictEqual(created.lastSessionId, "sess-1");
      assert.strictEqual(created.runs[0]?.reason, "manual");
      yield* Effect.yieldNow;
      assert.strictEqual(h.store.get(created.id)?.lastRunStatus, "succeeded");
    }),
  );

  it.effect("create without runNow does not start a session", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      assert.strictEqual(h.created.length, 0);
      assert.deepStrictEqual(created.runs, []);
      assert.isUndefined(created.lastSessionId);
    }),
  );

  it.effect("pauses after reaching maxRuns and does not fire again", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(
        cronInput({
          spec: { kind: "cron", expr: "* * * * *" },
          maxRuns: 1,
        }),
      );
      yield* TestClock.setTime(Date.parse(created.nextRunAt!));
      yield* h.service.tick();
      yield* Effect.yieldNow;
      const afterFire = h.store.get(created.id);
      assert.strictEqual(h.created.length, 1);
      assert.strictEqual(afterFire?.firedCount, 1);
      assert.strictEqual(afterFire?.enabled, false);
      assert.strictEqual(afterFire?.pauseReason, "max_runs");
      assert.strictEqual(afterFire?.nextRunAt, null);
      yield* TestClock.setTime(Date.parse("2026-08-27T09:00:00.000Z"));
      yield* h.service.tick();
      assert.strictEqual(h.created.length, 1);
      const skipped = yield* h.service.runNow(created.id);
      assert.strictEqual(h.created.length, 1);
      assert.isUndefined(skipped.ref);
      assert.strictEqual(skipped.schedule.lastRunStatus, "skipped");
      assert.strictEqual(skipped.schedule.runs[0]?.skipReason, "max_runs");
    }),
  );

  it.effect("pauses immediately when update sets maxRuns already reached", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      const created = yield* h.service.create(cronInput({ spec: { kind: "manual" } }));
      yield* h.service.runNow(created.id);
      yield* Effect.yieldNow;
      const capped = yield* h.service.update({ id: created.id, maxRuns: 1 });
      assert.strictEqual(capped.enabled, false);
      assert.strictEqual(capped.pauseReason, "max_runs");
      assert.strictEqual(capped.maxRuns, 1);
      const raised = yield* h.service.update({ id: created.id, maxRuns: 2, enabled: true });
      assert.strictEqual(raised.enabled, true);
      assert.isUndefined(raised.pauseReason);
      assert.strictEqual(raised.maxRuns, 2);
    }),
  );

  it.effect("daemon fires after TestClock advances past nextRunAt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(ORIGIN);
      const h = yield* harness();
      yield* h.service.create(cronInput({ spec: { kind: "every", everyMs: 60_000 } }));
      const fiber = yield* runScheduleLoop.pipe(
        Effect.provideService(ScheduleService, h.service),
        Effect.forkChild,
      );
      yield* TestClock.adjust("60 seconds");
      yield* Effect.yieldNow;
      assert.strictEqual(h.created.length, 1);
      const stored = Array.from(h.store.values())[0];
      assert.strictEqual(stored?.lastRunStatus, "succeeded");
      assert.strictEqual(stored?.runs[0]?.reason, "scheduled");
      yield* Fiber.interrupt(fiber);
    }),
  );
});
