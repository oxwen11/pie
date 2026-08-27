import { describe, expect, it } from "vitest";

import {
  applyRecurringJitter,
  CronError,
  nextOccurrence,
  parseCron,
  parseRunAt,
} from "../../src/automation/cron";

describe("parseCron", () => {
  it("accepts a 5-field expression", () => {
    expect(parseCron("0 9 * * 1-5").hour.values.has(9)).toBe(true);
  });

  it("rejects names and 6-field cron", () => {
    expect(() => parseCron("0 9 * * MON")).toThrow(CronError);
    expect(() => parseCron("* * * * * *")).toThrow(CronError);
  });
});

describe("nextOccurrence", () => {
  it("returns the next minute for * * * * *", () => {
    const after = Date.parse("2026-08-27T12:00:30.000Z");
    const next = nextOccurrence("* * * * *", after);
    expect(next).toBeGreaterThan(after);
    expect(new Date(next).getSeconds()).toBe(0);
  });
});

describe("parseRunAt", () => {
  it("requires a timezone", () => {
    expect(() => parseRunAt("2026-08-27T09:00:00")).toThrow(CronError);
    expect(parseRunAt("2026-08-27T09:00:00Z")).toBe(Date.parse("2026-08-27T09:00:00Z"));
  });
});

describe("applyRecurringJitter", () => {
  it("is deterministic for a given id", () => {
    const after = Date.parse("2026-08-27T00:00:00.000Z");
    expect(applyRecurringJitter("0 9 * * *", "aaaaaaaa", after)).toBe(
      applyRecurringJitter("0 9 * * *", "aaaaaaaa", after),
    );
  });
});
