import { describe, expect, it } from "vitest";

import { LoopError } from "../src/cron";
import type { LoopMessageDetails } from "../src/prompt";
import {
  DISPATCH_CONFIRM_MS,
  FALLBACK_MS,
  SessionLoopScheduler,
  type LoopDispatch,
} from "../src/scheduler";

class FakeClock {
  nowMs: number;
  constructor(nowMs: number) {
    this.nowMs = nowMs;
  }
  now(): number {
    return this.nowMs;
  }
  advance(ms: number): void {
    this.nowMs += ms;
  }
}

function setup(idle = true) {
  const clock = new FakeClock(Date.parse("2026-08-24T10:00:00+08:00"));
  const sent: Array<{ content: string; details: LoopMessageDetails }> = [];
  const dispatch: LoopDispatch & { idle: boolean; pending: boolean } = {
    idle,
    pending: false,
    isIdle() {
      return this.idle;
    },
    hasPendingMessages() {
      return this.pending;
    },
    sendScheduled(payload) {
      sent.push(payload);
    },
  };
  const scheduler = new SessionLoopScheduler({
    clock,
    dispatch,
    setInterval: ((fn: () => void) => {
      void fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearInterval: () => undefined,
    setTimeout: ((fn: () => void) => {
      fn();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  });
  scheduler.startSession();
  return { clock, dispatch, sent, scheduler };
}

function fire(scheduler: SessionLoopScheduler): void {
  scheduler.markStarted();
}

describe("command parse", () => {
  it("treats a leading compact interval as fixed, even with a comma", () => {
    const { scheduler } = setup();
    expect(scheduler.createFromCommand("1m tell me the time").kind).toBe("recurring");
    expect(scheduler.createFromCommand("1m, tell me what time is it.").kind).toBe("recurring");
    expect(scheduler.createFromCommand("1m, tell me what time is it.").schedule).toBe("* * * * *");
    expect(scheduler.createFromCommand("每 1 分钟 报时").kind).toBe("recurring");
    expect(scheduler.createFromCommand("1小时 报时").kind).toBe("recurring");
    expect(scheduler.createFromCommand("tell me 1m later").kind).toBe("dynamic");
    expect(scheduler.createFromCommand("每天报时").kind).toBe("dynamic");
    expect(scheduler.createFromCommand("every 5 minutes check").kind).toBe("dynamic");
  });
});

describe("scheduler", () => {
  it("dispatches a due recurring task when idle and coalesces misses", () => {
    const { clock, dispatch, sent, scheduler } = setup();
    const created = scheduler.createRecurring("check deploy", "*/5 * * * *", true);
    expect(created.kind).toBe("recurring");
    expect(sent).toHaveLength(0);

    clock.nowMs = Date.parse(created.next_fire_at!);
    scheduler.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).not.toMatch(/^\//);
    expect(sent[0]!.content).not.toContain("<system-reminder>");
    expect(sent[0]!.details.prompt).toBe("check deploy");
    fire(scheduler);

    clock.advance(30 * 60_000);
    dispatch.idle = false;
    scheduler.tick();
    expect(sent).toHaveLength(1);

    dispatch.idle = true;
    scheduler.handleSettled();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(scheduler.list()).toHaveLength(1);
  });

  it("keeps one pending per task while busy and drains one at a time", () => {
    const { clock, dispatch, sent, scheduler } = setup(false);
    scheduler.createRecurring("a", "* * * * *", true);
    scheduler.createRecurring("b", "* * * * *", true);
    clock.advance(3 * 60_000);
    scheduler.tick();
    expect(sent).toHaveLength(0);
    expect(scheduler.list().every((item) => item.pending)).toBe(true);

    dispatch.idle = true;
    scheduler.handleSettled();
    expect(sent).toHaveLength(1);
    fire(scheduler);
    scheduler.handleSettled();
    expect(sent).toHaveLength(2);
    expect(sent.map((item) => item.details.prompt).sort()).toEqual(["a", "b"]);
  });

  it("does not send from /loop while busy; dynamic first iteration waits", () => {
    const { dispatch, sent, scheduler } = setup(false);
    const created = scheduler.createFromCommand("check CI");
    expect(created.kind).toBe("dynamic");
    expect(created.pending).toBe(true);
    expect(sent).toHaveLength(0);
    dispatch.idle = true;
    scheduler.handleSettled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toContain("schedule_wakeup");
    expect(sent[0]!.details.prompt).toBe("check CI");
  });

  it("never uses steer", () => {
    const { dispatch, scheduler } = setup();
    scheduler.createFromCommand("5m ping");
    expect(Object.keys(dispatch)).not.toContain("steer");
  });

  it("releases an unstarted inFlight after 30s without resending", () => {
    const { clock, sent, scheduler } = setup();
    const created = scheduler.createFromCommand("ping once");
    expect(sent).toHaveLength(1);
    clock.advance(DISPATCH_CONFIRM_MS + 1);
    scheduler.tick();
    expect(sent).toHaveLength(1);
    expect(scheduler.list().some((item) => item.task_id === created.task_id)).toBe(false);
  });

  it("does not time out a started run", () => {
    const { clock, sent, scheduler } = setup();
    const created = scheduler.createFromCommand("watch CI");
    fire(scheduler);
    clock.advance(DISPATCH_CONFIRM_MS + 1);
    scheduler.tick();
    expect(scheduler.list().some((item) => item.task_id === created.task_id)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("handles dynamic wakeup, stop, and 20m fallback", () => {
    const { clock, scheduler } = setup();
    const created = scheduler.createFromCommand("watch CI");
    fire(scheduler);
    const scheduled = scheduler.scheduleWakeup({ delay_seconds: 120 });
    expect(scheduled).toContain("120");
    expect(() => scheduler.scheduleWakeup({ delay_seconds: 120 })).toThrow(LoopError);
    scheduler.handleSettled();
    const listed = scheduler.list().find((item) => item.task_id === created.task_id)!;
    expect(Date.parse(listed.next_fire_at!) - clock.now()).toBe(120_000);

    clock.advance(120_000);
    scheduler.tick();
    fire(scheduler);
    scheduler.handleSettled();
    const afterMiss = scheduler.list().find((item) => item.task_id === created.task_id)!;
    expect(Date.parse(afterMiss.next_fire_at!) - clock.now()).toBe(FALLBACK_MS);

    clock.advance(FALLBACK_MS);
    scheduler.tick();
    fire(scheduler);
    scheduler.handleSettled();
    expect(scheduler.list().some((item) => item.task_id === created.task_id)).toBe(false);
  });

  it("rejects wakeup when no dynamic inFlight", () => {
    const { scheduler } = setup();
    expect(() => scheduler.scheduleWakeup({ delay_seconds: 60 })).toThrow(/NO_ACTIVE_DYNAMIC_LOOP/);
    scheduler.createRecurring("fixed", "*/5 * * * *", true);
    expect(() => scheduler.scheduleWakeup({ delay_seconds: 60 })).toThrow(/NO_ACTIVE_DYNAMIC_LOOP/);
  });

  it("deletes future/pending without aborting in-flight work", () => {
    const { sent, scheduler } = setup();
    const created = scheduler.createFromCommand("watch CI");
    expect(scheduler.delete(created.task_id)).toBe("future_deleted_current_running");
    expect(sent).toHaveLength(1);
    expect(scheduler.delete("deadbeef")).toBe("not_found");
    const idle = scheduler.createRecurring("later", "*/5 * * * *", true);
    expect(scheduler.delete(idle.task_id)).toBe("deleted_before_dispatch");
  });

  it("caps at 50 tasks and no-ops ticks after shutdown", () => {
    const { dispatch, scheduler } = setup();
    for (let i = 0; i < 50; i += 1) {
      scheduler.createRecurring(`t${i}`, "*/5 * * * *", true);
    }
    expect(() => scheduler.createRecurring("overflow", "*/5 * * * *", true)).toThrow(
      /LOOP_LIMIT_REACHED/,
    );
    scheduler.dispose();
    dispatch.idle = true;
    expect(() => scheduler.createFromCommand("nope")).toThrow(/TASK_NOT_FOUND/);
    expect(() => scheduler.tick()).not.toThrow();
  });

  it("rejects an empty prompt", () => {
    const { scheduler } = setup();
    expect(() => scheduler.createRecurring("  ", "* * * * *", true)).toThrow(/prompt is empty/);
  });
});
