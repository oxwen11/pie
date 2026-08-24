import { describe, expect, it } from "vitest";

import {
  applyOneShotJitter,
  applyRecurringJitter,
  intervalToCron,
  LoopError,
  matchesCron,
  nextOccurrence,
  parseCompactInterval,
  parseCron,
  parseLeadingInterval,
  parseRunAt,
  previousOccurrence,
  stableHash,
} from "../src/cron";

describe("leading interval", () => {
  it("accepts compact, chinese units, and 每 at the start only", () => {
    expect(parseLeadingInterval("1m tell me the time")).toEqual({
      compact: "1m",
      prompt: "tell me the time",
    });
    expect(parseLeadingInterval("1m, tell me what time is it.")).toEqual({
      compact: "1m",
      prompt: "tell me what time is it.",
    });
    expect(parseLeadingInterval("1h check CI")).toEqual({ compact: "1h", prompt: "check CI" });
    expect(parseLeadingInterval("1 分钟 报时")).toEqual({ compact: "1m", prompt: "报时" });
    expect(parseLeadingInterval("1小时报时")).toEqual({ compact: "1h", prompt: "报时" });
    expect(parseLeadingInterval("每 1 分钟 报时")).toEqual({ compact: "1m", prompt: "报时" });
    expect(parseLeadingInterval("每1分钟报时")).toEqual({ compact: "1m", prompt: "报时" });
    expect(parseLeadingInterval("每隔 5m check")).toEqual({ compact: "5m", prompt: "check" });
  });

  it("does not parse mid-sentence or semantic phrases", () => {
    expect(parseLeadingInterval("tell me 1m later")).toBeNull();
    expect(parseLeadingInterval("every 5 minutes check")).toBeNull();
    expect(parseLeadingInterval("每天报时")).toBeNull();
    expect(parseLeadingInterval("每小时检查")).toBeNull();
    expect(parseLeadingInterval("检查 5m 超时")).toBeNull();
  });
});

describe("interval conversion", () => {
  it("maps compact intervals to 5-field cron", () => {
    expect(intervalToCron("30s").cron).toBe("* * * * *");
    expect(intervalToCron("5m").cron).toBe("*/5 * * * *");
    expect(intervalToCron("5m").adjustment).toBeNull();
    expect(intervalToCron("7m").cron).toBe("*/6 * * * *");
    expect(intervalToCron("90m").cron).toBe("0 */2 * * *");
    expect(intervalToCron("36h").cron).toBe("0 0 */2 * *");
    expect(intervalToCron("2d").cron).toBe("0 0 */2 * *");
    expect(intervalToCron("2d").adjustment).toMatch(/calendar-based/);
  });

  it("rejects non-positive, unknown unit, and >31d", () => {
    expect(() => parseCompactInterval("0m")).toThrow(LoopError);
    expect(() => parseCompactInterval("5x")).toThrow(LoopError);
    expect(() => intervalToCron("32d")).toThrow(/INVALID_INTERVAL/);
  });
});

describe("5-field cron", () => {
  it("rejects names, extensions, and non-5-field", () => {
    expect(() => parseCron("0 0 * * MON")).toThrow(/INVALID_CRON/);
    expect(() => parseCron("0 0 1W * *")).toThrow(/INVALID_CRON/);
    expect(() => parseCron("* * * * * *")).toThrow(/INVALID_CRON/);
  });

  it("uses Vixie OR when both DOM and DOW are restricted", () => {
    const expr = parseCron("0 0 1 * 1");
    // 2026-06-01 is Monday (1) and DOM 1 → match
    expect(matchesCron(expr, new Date(2026, 5, 1, 0, 0, 0))).toBe(true);
    // 2026-06-08 is Monday but not DOM 1 → still match via DOW
    expect(matchesCron(expr, new Date(2026, 5, 8, 0, 0, 0))).toBe(true);
    // 2026-07-01 is Wednesday, DOM 1 → match via DOM
    expect(matchesCron(expr, new Date(2026, 6, 1, 0, 0, 0))).toBe(true);
    // 2026-06-02 Tuesday neither → no
    expect(matchesCron(expr, new Date(2026, 5, 2, 0, 0, 0))).toBe(false);
  });

  it("finds next and previous minute-level fires", () => {
    const from = Date.parse("2026-08-24T10:00:00+08:00");
    const next = nextOccurrence("*/5 * * * *", from);
    expect(new Date(next).getMinutes() % 5).toBe(0);
    expect(next).toBeGreaterThan(from);
    const prev = previousOccurrence("*/5 * * * *", next);
    expect(prev).toBe(next - 5 * 60_000);
  });

  it("handles Feb 29 on leap years", () => {
    const from = Date.parse("2025-03-01T00:00:00+08:00");
    const next = nextOccurrence("0 0 29 2 *", from);
    const d = new Date(next);
    expect(d.getFullYear()).toBe(2028);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });
});

describe("run_at", () => {
  it("requires timezone and rejects the past", () => {
    expect(() => parseRunAt("2026-08-24T16:00:00")).toThrow(/INVALID_RUN_AT/);
    expect(parseRunAt("2026-08-24T16:00:00+08:00")).toBeGreaterThan(0);
  });
});

describe("jitter", () => {
  it("is stable for the same task id and stays within bounds", () => {
    const after = Date.parse("2026-08-24T10:00:00+08:00");
    const a = applyRecurringJitter("*/5 * * * *", "abcd1234", after);
    const b = applyRecurringJitter("*/5 * * * *", "abcd1234", after);
    expect(a).toBe(b);
    const nominal = nextOccurrence("*/5 * * * *", after);
    expect(a - nominal).toBeGreaterThanOrEqual(0);
    expect(a - nominal).toBeLessThanOrEqual(2.5 * 60_000);
  });

  it("only early-jitters :00/:30 one-shots, and not into the past", () => {
    const created = Date.parse("2026-08-24T15:59:50+08:00");
    const onHour = Date.parse("2026-08-24T16:00:00+08:00");
    const offHour = Date.parse("2026-08-24T16:10:00+08:00");
    expect(applyOneShotJitter(offHour, "abcd1234", created)).toBe(offHour);
    const jittered = applyOneShotJitter(onHour, "ffff0000", created);
    expect(jittered).toBeLessThanOrEqual(onHour);
    expect(onHour - jittered).toBeLessThanOrEqual(90_000);
    expect(jittered).toBeGreaterThan(created);
  });

  it("hashes the same id to the same number", () => {
    expect(stableHash("a1b2c3d4")).toBe(stableHash("a1b2c3d4"));
  });
});
