import { describe, expect, it } from "vitest";

import {
  CATCH_UP_MS,
  computeNextRunAt,
  countMissedSlots,
  isLate,
  isStale,
  LATE_MS,
  MAX_WAKE_MS,
  MIN_WAKE_MS,
  nextWakeDelayMs,
  validateExpiresAt,
  validateSpec,
} from "../../src/automation/next-run";

const NOW = Date.parse("2026-08-27T08:00:00.000Z");

describe("validateSpec", () => {
  it("accepts everyMs in range and rejects out of range", () => {
    expect(() => validateSpec({ kind: "every", everyMs: 60_000 }, NOW)).not.toThrow();
    expect(() => validateSpec({ kind: "every", everyMs: 1_000 }, NOW)).toThrow(/everyMs/);
  });

  it("rejects an unknown cron timezone", () => {
    expect(() =>
      validateSpec({ kind: "cron", expr: "0 9 * * *", timeZone: "Not/AZone" }, NOW),
    ).toThrow(/time zone/);
  });
});

describe("validateExpiresAt", () => {
  it("requires a future timezone-aware instant", () => {
    expect(() => validateExpiresAt(undefined, NOW)).not.toThrow();
    expect(() => validateExpiresAt("2026-08-27T09:00:00.000Z", NOW)).not.toThrow();
    expect(() => validateExpiresAt("2026-08-27T07:00:00.000Z", NOW)).toThrow(/expires_at/);
  });
});

describe("computeNextRunAt", () => {
  it("adds everyMs without jitter", () => {
    expect(computeNextRunAt({ kind: "every", everyMs: 60_000 }, "id", NOW)).toBe(NOW + 60_000);
  });

  it("returns null for manual", () => {
    expect(computeNextRunAt({ kind: "manual" }, "id", NOW)).toBeNull();
  });
});

describe("countMissedSlots", () => {
  it("counts skipped every intervals after the due slot", () => {
    expect(countMissedSlots({ kind: "every", everyMs: 60_000 }, NOW, NOW + 90_000)).toBe(1);
    expect(countMissedSlots({ kind: "every", everyMs: 60_000 }, NOW, NOW + 5 * 60_000)).toBe(5);
  });

  it("is zero when the due slot is still the current one", () => {
    expect(countMissedSlots({ kind: "every", everyMs: 60_000 }, NOW, NOW + 30_000)).toBe(0);
  });
});

describe("lateness", () => {
  it("treats a gap over a minute as late and over seven days as stale", () => {
    expect(isLate(NOW, NOW + LATE_MS)).toBe(false);
    expect(isLate(NOW, NOW + LATE_MS + 1)).toBe(true);
    expect(isStale(NOW, NOW + CATCH_UP_MS)).toBe(false);
    expect(isStale(NOW, NOW + CATCH_UP_MS + 1)).toBe(true);
  });
});

describe("nextWakeDelayMs", () => {
  it("caps the delay between one and sixty seconds", () => {
    expect(nextWakeDelayMs([], NOW)).toBe(MAX_WAKE_MS);
    expect(nextWakeDelayMs([NOW + 500], NOW)).toBe(MIN_WAKE_MS);
    expect(nextWakeDelayMs([NOW + 10_000], NOW)).toBe(10_000);
    expect(nextWakeDelayMs([NOW + 120_000], NOW)).toBe(MAX_WAKE_MS);
    expect(nextWakeDelayMs([null, NOW + 15_000], NOW)).toBe(15_000);
  });
});
