import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AutomationSchema,
  CreateAutomationInputSchema,
  MAX_AUTOMATION_EVERY_MS,
  MIN_AUTOMATION_EVERY_MS,
} from "../src/automation";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("CreateAutomationInput", () => {
  it("accepts every, timezone cron, and merged output", () => {
    expect(
      accepts(CreateAutomationInputSchema, {
        name: "Nightly",
        projectId: UUID,
        prompt: "review",
        spec: { kind: "every", everyMs: MIN_AUTOMATION_EVERY_MS },
        outputMode: "merged",
        expiresAt: "2026-12-01T00:00:00.000Z",
      }),
    ).toBe(true);
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

  it("rejects the retired started status", () => {
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
        lastRunStatus: "started",
        runs: [],
      }),
    ).toBe(false);
  });
});
