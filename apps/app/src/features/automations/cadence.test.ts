import { describe, expect, it } from "vitest";

import {
  defaultOnceLocal,
  defaultAutomationForm,
  formatNextRun,
  formatSpec,
  formFromSpec,
  specFromForm,
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

  it("round-trips preset cron expressions", () => {
    const base = defaultAutomationForm("proj");
    const specs = [
      specFromForm({ ...base, cadence: "hourly" }),
      specFromForm({ ...base, cadence: "daily", time: "09:00" }),
      specFromForm({ ...base, cadence: "weekdays", time: "09:00" }),
      specFromForm({ ...base, cadence: "weekly", time: "09:00", weekday: "1" }),
    ];
    expect(specs.map((spec) => formFromSpec(spec, base).cadence)).toEqual([
      "hourly",
      "daily",
      "weekdays",
      "weekly",
    ]);
  });
});

describe("formatSpec", () => {
  it("labels presets in English", () => {
    expect(formatSpec({ kind: "manual" })).toBe("Manual");
    expect(formatSpec({ kind: "cron", expr: "0 9 * * *" })).toBe("Daily at 09:00");
    expect(formatSpec({ kind: "cron", expr: "*/15 * * * *" })).toBe("*/15 * * * *");
  });
});

describe("formatNextRun", () => {
  it("labels paused and manual automations", () => {
    expect(formatNextRun("2026-08-27T09:00:00.000Z", false)).toBe("Paused");
    expect(formatNextRun(null, true)).toBe("Run now only");
  });
});

describe("defaultOnceLocal", () => {
  it("picks 9:00 tomorrow in local time", () => {
    const from = new Date(2026, 7, 27, 15, 45, 0);
    expect(defaultOnceLocal(from)).toBe("2026-08-28T09:00");
  });
});
