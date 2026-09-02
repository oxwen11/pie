import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AutomationSchema,
  automationSessionOf,
  countFiredRuns,
  CreateAutomationInputSchema,
  firedRunCount,
  MAX_AUTOMATION_EVERY_MS,
  MAX_AUTOMATION_MAX_RUNS,
  MIN_AUTOMATION_EVERY_MS,
  persistAutomationSession,
  reachedMaxRuns,
  reuseSessionIdOf,
  bindAutomationSession,
  UpdateAutomationInputSchema,
} from "../src/automation";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("CreateAutomationInput", () => {
  it("accepts every, timezone cron, and a reused session", () => {
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Nightly",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MIN_AUTOMATION_EVERY_MS },
        session: { policy: "existing", sessionId: UUID },
        expiresAt: "2026-12-01T00:00:00.000Z",
        maxRuns: 3,
        runNow: true,
      }),
    ).toBe(true);
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "First run",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "owned" },
      }),
    ).toBe(true);
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Fresh",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "isolated" },
      }),
    ).toBe(true);
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Bare reuse",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "manual" },
        session: { policy: "existing" },
      }),
    ).toBe(false);
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "TZ",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "cron", expr: "0 9 * * *", timeZone: "UTC" },
      }),
    ).toBe(true);
  });

  it("rejects an interval below the minimum", () => {
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Too fast",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MIN_AUTOMATION_EVERY_MS - 1 },
      }),
    ).toBe(false);
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Too slow",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MAX_AUTOMATION_EVERY_MS + 1 },
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
    expect(accepts(CreateAutomationInputSchema, { ...base, maxRuns: 1 })).toBe(true);
    expect(accepts(CreateAutomationInputSchema, { ...base, maxRuns: 0 })).toBe(false);
    expect(accepts(CreateAutomationInputSchema, { ...base, maxRuns: 1.5 })).toBe(false);
    expect(
      accepts(CreateAutomationInputSchema, { ...base, maxRuns: MAX_AUTOMATION_MAX_RUNS + 1 }),
    ).toBe(false);
    expect(accepts(UpdateAutomationInputSchema, { id: UUID, maxRuns: null })).toBe(true);
  });
});

describe("AutomationSession helpers", () => {
  it("defaults omitted session to isolated and persists owned/existing", () => {
    expect(automationSessionOf({})).toEqual({ policy: "isolated" });
    expect(reuseSessionIdOf({ policy: "existing", sessionId: UUID })).toBe(UUID);
    expect(reuseSessionIdOf({ policy: "owned", sessionId: UUID })).toBe(UUID);
    expect(reuseSessionIdOf({ policy: "isolated" })).toBeUndefined();
    expect(persistAutomationSession({ policy: "isolated" })).toEqual({});
    expect(persistAutomationSession({ policy: "owned" })).toEqual({
      session: { policy: "owned" },
    });
    expect(bindAutomationSession({ policy: "owned" }, UUID)).toEqual({
      policy: "owned",
      sessionId: UUID,
    });
    expect(bindAutomationSession({ policy: "isolated" }, UUID)).toBeUndefined();
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

describe("Automation", () => {
  it("accepts the run lifecycle statuses", () => {
    expect(
      accepts(AutomationSchema, {
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
    const decoded = Schema.decodeUnknownSync(AutomationSchema)({
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
});
