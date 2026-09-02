import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ScheduleSchema,
  scheduleSessionOf,
  countFiredRuns,
  CreateScheduleInputSchema,
  firedRunCount,
  MAX_SCHEDULE_EVERY_MS,
  MAX_SCHEDULE_MAX_RUNS,
  MIN_SCHEDULE_EVERY_MS,
  persistScheduleSession,
  reachedMaxRuns,
  reuseSessionIdOf,
  bindScheduleSession,
  UpdateScheduleInputSchema,
} from "../src/schedule";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("CreateScheduleInput", () => {
  it("accepts every, timezone cron, and a reused session", () => {
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "Nightly",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MIN_SCHEDULE_EVERY_MS },
        session: { policy: "existing", sessionId: UUID },
        expiresAt: "2026-12-01T00:00:00.000Z",
        maxRuns: 3,
        runNow: true,
      }),
    ).toBe(true);
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "First run",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "owned" },
      }),
    ).toBe(true);
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "Fresh",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "isolated" },
      }),
    ).toBe(true);
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "Bare reuse",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "existing" },
      }),
    ).toBe(false);
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "TZ",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "cron", expr: "0 9 * * *", timeZone: "UTC" },
      }),
    ).toBe(true);
  });

  it("rejects an interval below the minimum", () => {
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "Too fast",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MIN_SCHEDULE_EVERY_MS - 1 },
      }),
    ).toBe(false);
    expect(
      accepts(CreateScheduleInputSchema, {
        name: "Too slow",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MAX_SCHEDULE_EVERY_MS + 1 },
      }),
    ).toBe(false);
  });

  it("rejects a maxRuns outside 1…10000", () => {
    const base = {
      name: "Capped",
      projectId: UUID,
      prompt: "review",
      spec: { kind: "manual" },
    };
    expect(accepts(CreateScheduleInputSchema, { ...base, maxRuns: 1 })).toBe(true);
    expect(accepts(CreateScheduleInputSchema, { ...base, maxRuns: 0 })).toBe(false);
    expect(accepts(CreateScheduleInputSchema, { ...base, maxRuns: 1.5 })).toBe(false);
    expect(
      accepts(CreateScheduleInputSchema, { ...base, maxRuns: MAX_SCHEDULE_MAX_RUNS + 1 }),
    ).toBe(false);
    expect(accepts(UpdateScheduleInputSchema, { id: UUID, maxRuns: null })).toBe(true);
  });
});

describe("ScheduleSession helpers", () => {
  it("defaults omitted session to isolated and persists owned/existing", () => {
    expect(scheduleSessionOf({})).toEqual({ policy: "isolated" });
    expect(reuseSessionIdOf({ policy: "existing", sessionId: UUID })).toBe(UUID);
    expect(reuseSessionIdOf({ policy: "owned", sessionId: UUID })).toBe(UUID);
    expect(reuseSessionIdOf({ policy: "isolated" })).toBeUndefined();
    expect(persistScheduleSession({ policy: "isolated" })).toEqual({});
    expect(persistScheduleSession({ policy: "owned" })).toEqual({
      session: { policy: "owned" },
    });
    expect(bindScheduleSession({ policy: "owned" }, UUID)).toEqual({
      policy: "owned",
      sessionId: UUID,
    });
    expect(bindScheduleSession({ policy: "isolated" }, UUID)).toBeUndefined();
  });
});

describe("maxRuns helpers", () => {
  it("counts running, succeeded, failed, and interrupted only", () => {
    expect(
      countFiredRuns([
        { status: "running" },
        { status: "succeeded" },
        { status: "failed" },
        { status: "interrupted" },
        { status: "missed" },
        { status: "skipped" },
      ]),
    ).toBe(4);
    expect(firedRunCount({ runs: [{ status: "succeeded" }], firedCount: 12 })).toBe(12);
    expect(reachedMaxRuns({ maxRuns: 1, runs: [{ status: "running" }] })).toBe(true);
    expect(reachedMaxRuns({ maxRuns: 2, firedCount: 1, runs: [] })).toBe(false);
  });
});

describe("Schedule", () => {
  it("accepts the run lifecycle statuses", () => {
    expect(
      accepts(ScheduleSchema, {
        id: UUID,
        name: "Nightly",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        enabled: true,
        createdAt: "2026-08-27T08:00:00.000Z",
        updatedAt: "2026-08-27T08:00:00.000Z",
        nextRunAt: null,
        maxRuns: 4,
        firedCount: 1,
        runs: [
          {
            id: "run-1",
            startedAt: "2026-08-27T08:00:00.000Z",
            reason: "missed_recovery",
            status: "running",
          },
        ],
      }),
    ).toBe(true);
  });

  it("maps the retired started status to running", () => {
    const decoded = Schema.decodeUnknownSync(ScheduleSchema)({
      id: UUID,
      name: "Nightly",
      projectId: UUID,
      prompt: "review",
      spec: { kind: "manual" },
      enabled: true,
      createdAt: "2026-08-27T08:00:00.000Z",
      updatedAt: "2026-08-27T08:00:00.000Z",
      nextRunAt: null,
      lastRunStatus: "started",
      runs: [
        {
          id: "run-1",
          startedAt: "2026-08-27T08:00:00.000Z",
          reason: "manual",
          status: "started",
        },
      ],
    });
    expect(decoded.lastRunStatus).toBe("running");
    expect(decoded.runs[0]?.status).toBe("running");
  });

  it("reads a run snapshot that predates session policy", () => {
    expect(
      accepts(ScheduleSchema, {
        id: UUID,
        name: "Legacy",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        enabled: true,
        createdAt: "2026-08-27T08:00:00.000Z",
        updatedAt: "2026-08-27T08:00:00.000Z",
        nextRunAt: null,
        runs: [
          {
            id: "run-1",
            startedAt: "2026-08-27T08:00:00.000Z",
            reason: "manual",
            status: "succeeded",
            snapshot: {
              name: "Legacy",
              prompt: "review",
              projectId: UUID,
              spec: { kind: "manual" },
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
