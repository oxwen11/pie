import { describe, expect, it } from "vitest";

import {
  defaultOnceLocal,
  defaultAutomationForm,
  formatLastRun,
  formatNextRun,
  formatRunDuration,
  formatRunReason,
  formatRunStatus,
  formatRunSummary,
  formatSkipReason,
  formatSpec,
  formFromSpec,
  specFromForm,
  summarizeRuns,
} from "./cadence";

describe("specFromForm", () => {
  it("builds daily and weekday cron from a time picker", () => {
    const base = defaultAutomationForm("proj");
    expect(specFromForm({ ...base, cadence: "daily", time: "09:30" })).toEqual({
      kind: "cron",
      expr: "30 9 * * *",
    });
    expect(specFromForm({ ...base, cadence: "weekdays", time: "18:00" })).toEqual({
      kind: "cron",
      expr: "0 18 * * 1-5",
    });
    expect(specFromForm({ ...base, cadence: "weekly", time: "09:00", weekday: "3" })).toEqual({
      kind: "cron",
      expr: "0 9 * * 3",
    });
    expect(specFromForm({ ...base, cadence: "daily", time: "09:30:00" })).toEqual({
      kind: "cron",
      expr: "30 9 * * *",
    });
  });

  it("builds an interval spec from amount and unit", () => {
    const base = defaultAutomationForm("proj");
    expect(
      specFromForm({ ...base, cadence: "every", everyAmount: "15", everyUnit: "minutes" }),
    ).toEqual({ kind: "every", everyMs: 15 * 60_000 });
    expect(
      specFromForm({ ...base, cadence: "every", everyAmount: "2", everyUnit: "hours" }),
    ).toEqual({
      kind: "every",
      everyMs: 2 * 60 * 60_000,
    });
  });

  it("attaches a timezone only on custom cron", () => {
    const base = defaultAutomationForm("proj");
    expect(
      specFromForm({ ...base, cadence: "cron", cron: "0 9 * * 1-5", timeZone: "UTC" }),
    ).toEqual({ kind: "cron", expr: "0 9 * * 1-5", timeZone: "UTC" });
    expect(specFromForm({ ...base, cadence: "daily", time: "09:00", timeZone: "UTC" })).toEqual({
      kind: "cron",
      expr: "0 9 * * *",
    });
  });

  it("round-trips preset cron expressions", () => {
    const base = defaultAutomationForm("proj");
    const specs = [
      specFromForm({ ...base, cadence: "hourly" }),
      specFromForm({ ...base, cadence: "daily", time: "09:00" }),
      specFromForm({ ...base, cadence: "weekdays", time: "09:00" }),
      specFromForm({ ...base, cadence: "weekly", time: "09:00", weekday: "1" }),
      specFromForm({ ...base, cadence: "every", everyAmount: "1", everyUnit: "hours" }),
    ];
    expect(specs.map((spec) => formFromSpec(spec, base).cadence)).toEqual([
      "hourly",
      "daily",
      "weekdays",
      "weekly",
      "every",
    ]);
  });

  it("keeps a timezone cron on the custom cadence", () => {
    const base = defaultAutomationForm("proj");
    const form = formFromSpec({ kind: "cron", expr: "0 9 * * *", timeZone: "UTC" }, base);
    expect(form.cadence).toBe("cron");
    expect(form.timeZone).toBe("UTC");
  });
});

describe("formatSpec", () => {
  it("labels presets in English", () => {
    expect(formatSpec({ kind: "manual" })).toBe("Manual");
    expect(formatSpec({ kind: "cron", expr: "0 9 * * *" })).toBe("Daily at 09:00");
    expect(formatSpec({ kind: "cron", expr: "*/15 * * * *" })).toBe("*/15 * * * *");
    expect(formatSpec({ kind: "cron", expr: "0 9 * * *", timeZone: "UTC" })).toBe(
      "0 9 * * * (UTC)",
    );
    expect(formatSpec({ kind: "every", everyMs: 15 * 60_000 })).toBe("Every 15 minutes");
    expect(formatSpec({ kind: "every", everyMs: 60 * 60_000 })).toBe("Every 1 hour");
  });
});

describe("formatNextRun", () => {
  it("labels paused, expired, and manual automations", () => {
    expect(formatNextRun("2026-08-27T09:00:00.000Z", false)).toBe("Paused");
    expect(formatNextRun(null, false, "failureCircuit")).toBe("Paused after repeated failures");
    expect(formatNextRun(null, false, "expired")).toBe("Expired");
    expect(formatNextRun(null, true)).toBe("Run now only");
  });
});

describe("formatRunStatus", () => {
  it("labels every persisted status", () => {
    expect(formatRunStatus("running")).toBe("Running");
    expect(formatRunStatus("succeeded")).toBe("Succeeded");
    expect(formatRunStatus("missed")).toBe("Missed");
    expect(formatSkipReason("queue_overflow")).toBe("already running");
  });
});

describe("run history labels", () => {
  it("labels fire reasons and durations", () => {
    expect(formatRunReason("manual")).toBe("Run now");
    expect(formatRunReason("scheduled")).toBe("Scheduled");
    expect(formatRunReason("missed_recovery")).toBe("Missed recovery");
    expect(formatRunDuration("2026-08-27T09:00:00.000Z", "2026-08-27T09:00:02.400Z", 0)).toBe("2s");
    expect(
      formatRunDuration(
        "2026-08-27T09:00:00.000Z",
        undefined,
        Date.parse("2026-08-27T09:01:30.000Z"),
      ),
    ).toBe("1m 30s");
  });

  it("summarizes stored run statuses in one pass", () => {
    expect(
      formatRunSummary(
        summarizeRuns([
          { status: "succeeded" },
          { status: "succeeded" },
          { status: "failed" },
          { status: "missed" },
          { status: "running" },
        ]),
      ),
    ).toBe("1 running · 2 succeeded · 1 failed · 1 missed");
    expect(formatRunSummary(summarizeRuns([]))).toBeNull();
  });

  it("labels the latest run on the card", () => {
    expect(
      formatLastRun({
        lastRunStatus: "skipped",
        lastRunAt: "2026-08-27T09:00:00.000Z",
        runs: [{ skipReason: "expired" }],
      }),
    ).toBe(`Skipped (expired) ${new Date("2026-08-27T09:00:00.000Z").toLocaleString()}`);
    expect(
      formatLastRun({
        lastRunStatus: "failed",
        lastRunAt: "2026-08-27T09:00:00.000Z",
        lastError: "session crashed",
        runs: [],
      }),
    ).toBe(`Failed ${new Date("2026-08-27T09:00:00.000Z").toLocaleString()}: session crashed`);
  });
});

describe("defaultOnceLocal", () => {
  it("picks 9:00 tomorrow in local time", () => {
    const from = new Date(2026, 7, 27, 15, 45, 0);
    expect(defaultOnceLocal(from)).toBe("2026-08-28T09:00");
  });
});
