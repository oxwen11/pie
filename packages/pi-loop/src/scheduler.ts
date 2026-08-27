import crypto from "node:crypto";

import {
  applyOneShotJitter,
  applyRecurringJitter,
  intervalToCron,
  LoopError,
  nextOccurrence,
  parseCron,
  parseLeadingInterval,
  parseRunAt,
} from "./cron";
import {
  assertPromptSize,
  buildScheduledContent,
  previewPrompt,
  resolveMaintenancePrompt,
  type LoopMessageDetails,
} from "./prompt";

export const MAX_TASKS = 50;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FALLBACK_MS = 20 * 60 * 1000;
export const DISPATCH_CONFIRM_MS = 30_000;

export interface LoopClock {
  now(): number;
}

export interface LoopDispatch {
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  sendScheduled(payload: { content: string; details: LoopMessageDetails }): void;
}

interface LoopTaskBase {
  id: string;
  prompt: string;
  createdAt: number;
  nextFireAt: number | null;
  pendingSince: number | null;
}

export interface RecurringTask extends LoopTaskBase {
  kind: "recurring";
  cron: string;
  expiresAt: number;
}

export interface OneShotTask extends LoopTaskBase {
  kind: "one_shot";
  cron: string | null;
  runAt: number;
  expiresAt: null;
}

type LoopCommandArgs = {
  interval?: string;
  prompt: string;
  maintenance: boolean;
};

export interface DynamicTask extends LoopTaskBase {
  kind: "dynamic";
  expiresAt: number;
  fallbackCount: 0 | 1;
  decision: "unset" | "scheduled" | "stopped";
}

export type LoopTask = RecurringTask | OneShotTask | DynamicTask;

export interface InFlight {
  taskId: string;
  started: boolean;
  dispatchedAt: number;
}

export interface CreateResult {
  task_id: string;
  kind: LoopTask["kind"];
  schedule: string;
  next_fire_at: string | null;
  expires_at: string | null;
  pending: boolean;
  adjustment: string | null;
}

export interface CronListItem {
  task_id: string;
  kind: LoopTask["kind"];
  prompt_preview: string;
  schedule: string;
  next_fire_at: string | null;
  expires_at: string | null;
  pending: boolean;
  running: boolean;
}

export interface SchedulerHost {
  clock: LoopClock;
  dispatch: LoopDispatch;
  randomBytes?: (size: number) => Uint8Array;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  setTimeout?: typeof setTimeout;
  getCwd?: () => string;
  isProjectTrusted?: () => boolean;
}

export class SessionLoopScheduler {
  private tasks = new Map<string, LoopTask>();
  private inFlight: InFlight | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private session: number | null = null;
  private nextSession = 1;
  private readonly host: SchedulerHost;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly randomBytesFn: (size: number) => Uint8Array;

  constructor(host: SchedulerHost) {
    this.host = host;
    this.setIntervalFn = host.setInterval ?? setInterval;
    this.clearIntervalFn = host.clearInterval ?? clearInterval;
    this.setTimeoutFn = host.setTimeout ?? setTimeout;
    this.randomBytesFn = host.randomBytes ?? ((size) => crypto.randomBytes(size));
  }

  startSession(): void {
    this.reset();
    this.session = this.nextSession++;
  }

  dispose(): void {
    this.reset();
    this.session = null;
  }

  markStarted(): void {
    if (this.stale() || !this.inFlight) return;
    this.inFlight.started = true;
  }

  handleSettled(): void {
    const session = this.session;
    if (session === null) return;
    const flight = this.inFlight;
    if (flight?.started) this.finishFlight(flight);
    else if (flight) this.releaseUnstarted(flight);
    this.setTimeoutFn(() => {
      if (this.session !== session) return;
      this.drain();
    }, 0);
  }

  tick(): void {
    if (this.stale()) return;
    const now = this.host.clock.now();
    if (
      this.inFlight &&
      !this.inFlight.started &&
      now - this.inFlight.dispatchedAt > DISPATCH_CONFIRM_MS
    ) {
      this.releaseUnstarted(this.inFlight);
    }
    this.markDue(now);
    this.drain();
  }

  parseLoopArgs(args: string): LoopCommandArgs {
    const trimmed = args.trim();
    if (!trimmed) return { prompt: this.maintenancePrompt(), maintenance: true };
    const leading = parseLeadingInterval(trimmed);
    if (leading) {
      return {
        interval: leading.compact,
        prompt: leading.prompt || this.maintenancePrompt(),
        maintenance: leading.prompt.length === 0,
      };
    }
    return { prompt: trimmed, maintenance: false };
  }

  createFromCommand(args: string): CreateResult {
    const parsed = this.parseLoopArgs(args);
    if (parsed.interval) {
      const converted = intervalToCron(parsed.interval);
      return this.createRecurring(parsed.prompt, converted.cron, true, converted.adjustment);
    }
    return this.createDynamic(parsed.prompt);
  }

  createRecurring(
    prompt: string,
    cron: string,
    recurring: boolean,
    adjustment: string | null = null,
  ): CreateResult {
    this.assertActive();
    this.assertPrompt(prompt);
    this.assertCapacity();
    parseCron(cron);
    const now = this.host.clock.now();
    const id = this.allocId();
    if (recurring) {
      const task: RecurringTask = {
        id,
        prompt,
        kind: "recurring",
        cron,
        createdAt: now,
        expiresAt: now + TTL_MS,
        nextFireAt: applyRecurringJitter(cron, id, now),
        pendingSince: null,
      };
      this.add(task);
      return this.toCreateResult(task, cron, adjustment);
    }
    const next = nextOccurrence(cron, now);
    const task: OneShotTask = {
      id,
      prompt,
      kind: "one_shot",
      cron,
      runAt: next,
      createdAt: now,
      expiresAt: null,
      nextFireAt: applyOneShotJitter(next, id, now),
      pendingSince: null,
    };
    this.add(task);
    return this.toCreateResult(task, cron, adjustment);
  }

  createOneShot(prompt: string, runAtIso: string): CreateResult {
    this.assertActive();
    this.assertPrompt(prompt);
    this.assertCapacity();
    const now = this.host.clock.now();
    const runAt = parseRunAt(runAtIso);
    if (runAt <= now) throw new LoopError("INVALID_RUN_AT", "run_at is in the past");
    const id = this.allocId();
    const task: OneShotTask = {
      id,
      prompt,
      kind: "one_shot",
      cron: null,
      runAt,
      createdAt: now,
      expiresAt: null,
      nextFireAt: applyOneShotJitter(runAt, id, now),
      pendingSince: null,
    };
    this.add(task);
    return this.toCreateResult(task, runAtIso, null);
  }

  createDynamic(prompt: string): CreateResult {
    this.assertActive();
    this.assertPrompt(prompt);
    this.assertCapacity();
    const now = this.host.clock.now();
    const id = this.allocId();
    const task: DynamicTask = {
      id,
      prompt,
      kind: "dynamic",
      createdAt: now,
      expiresAt: now + TTL_MS,
      nextFireAt: null,
      pendingSince: now,
      fallbackCount: 0,
      decision: "unset",
    };
    this.add(task);
    this.tryDispatch(task);
    return this.toCreateResult(task, "dynamic", null);
  }

  list(): CronListItem[] {
    return [...this.tasks.values()]
      .sort((a, b) => {
        const an = a.nextFireAt ?? Number.POSITIVE_INFINITY;
        const bn = b.nextFireAt ?? Number.POSITIVE_INFINITY;
        if (an !== bn) return an - bn;
        return a.id.localeCompare(b.id);
      })
      .map((task) => this.toListItem(task));
  }

  delete(
    taskId: string,
  ): "deleted_before_dispatch" | "future_deleted_current_running" | "not_found" {
    const task = this.tasks.get(taskId);
    if (!task) return "not_found";
    const running = this.inFlight?.taskId === taskId;
    this.removeTask(taskId);
    return running ? "future_deleted_current_running" : "deleted_before_dispatch";
  }

  scheduleWakeup(input: { delay_seconds?: number; stop?: boolean }): string {
    this.assertActive();
    const flight = this.inFlight;
    const task = flight ? this.tasks.get(flight.taskId) : undefined;
    if (!flight || !task || task.kind !== "dynamic") {
      throw new LoopError(
        "NO_ACTIVE_DYNAMIC_LOOP",
        "schedule_wakeup is only valid during a scheduled dynamic iteration",
      );
    }
    const hasDelay = input.delay_seconds != null;
    const hasStop = input.stop === true;
    if (hasDelay === hasStop) {
      throw new LoopError(
        "INVALID_WAKEUP_DELAY",
        "provide exactly one of delay_seconds or stop=true",
      );
    }
    if (task.decision !== "unset") {
      throw new LoopError("WAKEUP_DECISION_ALREADY_SET", "already decided this iteration");
    }
    if (hasStop) {
      task.decision = "stopped";
      return "stopped";
    }
    const delay = input.delay_seconds!;
    if (!Number.isInteger(delay) || delay < 60 || delay > 3600) {
      throw new LoopError("INVALID_WAKEUP_DELAY", "delay_seconds must be 60-3600");
    }
    task.decision = "scheduled";
    task.nextFireAt = this.host.clock.now() + delay * 1000;
    task.fallbackCount = 0;
    return `scheduled in ${delay}s`;
  }

  private markDue(now: number): void {
    const due = [...this.tasks.values()]
      .filter((task) => task.nextFireAt != null && task.nextFireAt <= now)
      .sort(compareDue);
    for (const task of due) {
      if (task.kind === "recurring") {
        const next = applyRecurringJitter(task.cron, task.id, now);
        task.nextFireAt = next > task.expiresAt ? null : next;
      } else {
        task.nextFireAt = null;
      }
      if (task.pendingSince == null) task.pendingSince = now;
    }
    for (const task of this.tasks.values()) {
      if (task.kind === "one_shot") continue;
      if (now >= task.expiresAt && task.pendingSince == null && this.inFlight?.taskId !== task.id) {
        this.removeTask(task.id);
      }
    }
  }

  private drain(): void {
    if (this.inFlight) return;
    const pending = [...this.tasks.values()]
      .filter((task) => task.pendingSince != null)
      .sort((a, b) => {
        const dt = (a.pendingSince ?? 0) - (b.pendingSince ?? 0);
        return dt !== 0 ? dt : a.id.localeCompare(b.id);
      });
    const next = pending[0];
    if (next) this.tryDispatch(next);
  }

  private tryDispatch(task: LoopTask): boolean {
    if (!this.canDispatch()) {
      task.pendingSince ??= this.host.clock.now();
      return false;
    }
    const now = this.host.clock.now();
    this.inFlight = { taskId: task.id, started: false, dispatchedAt: now };
    task.pendingSince = null;
    if (task.kind === "dynamic") task.decision = "unset";
    this.host.dispatch.sendScheduled({
      content: buildScheduledContent(task.prompt, task.kind === "dynamic"),
      details: { taskId: task.id, kind: task.kind, prompt: task.prompt },
    });
    return true;
  }

  private canDispatch(): boolean {
    if (this.stale() || this.inFlight) return false;
    try {
      return this.host.dispatch.isIdle() && !this.host.dispatch.hasPendingMessages();
    } catch {
      return false;
    }
  }

  private finishFlight(flight: InFlight): void {
    const task = this.tasks.get(flight.taskId);
    this.inFlight = null;
    if (!task) return;
    const now = this.host.clock.now();
    if (task.kind === "one_shot") {
      this.removeTask(task.id);
      return;
    }
    if (now >= task.expiresAt) {
      this.removeTask(task.id);
      return;
    }
    if (task.kind !== "dynamic") return;
    if (task.decision === "stopped") {
      this.removeTask(task.id);
      return;
    }
    if (task.decision === "scheduled") {
      task.pendingSince = null;
      return;
    }
    if (task.fallbackCount === 0) {
      task.fallbackCount = 1;
      task.nextFireAt = now + FALLBACK_MS;
      return;
    }
    this.removeTask(task.id);
  }

  private releaseUnstarted(flight: InFlight): void {
    const task = this.tasks.get(flight.taskId);
    this.inFlight = null;
    if (!task) return;
    if (task.kind === "recurring") {
      task.pendingSince = null;
      return;
    }
    this.removeTask(task.id);
  }

  private add(task: LoopTask): void {
    this.tasks.set(task.id, task);
    this.ensureTimer();
  }

  private removeTask(id: string): void {
    this.tasks.delete(id);
    if (this.tasks.size === 0) this.stopTimer();
  }

  private reset(): void {
    this.stopTimer();
    this.tasks.clear();
    this.inFlight = null;
  }

  private ensureTimer(): void {
    if (this.tickTimer || this.session === null) return;
    this.tickTimer = this.setIntervalFn(() => this.tick(), 1000);
  }

  private stopTimer(): void {
    if (!this.tickTimer) return;
    this.clearIntervalFn(this.tickTimer);
    this.tickTimer = null;
  }

  private stale(): boolean {
    return this.session === null;
  }

  private assertActive(): void {
    if (this.session === null) throw new LoopError("TASK_NOT_FOUND", "session is not active");
  }

  private assertCapacity(): void {
    if (this.tasks.size >= MAX_TASKS) {
      throw new LoopError("LOOP_LIMIT_REACHED", "current session already has 50 active tasks");
    }
  }

  private assertPrompt(prompt: string): void {
    if (!prompt.trim()) throw new LoopError("PROMPT_TOO_LARGE", "prompt is empty");
    assertPromptSize(prompt);
  }

  private allocId(): string {
    for (let i = 0; i < 8; i += 1) {
      const id = toHex(this.randomBytesFn(4));
      if (!this.tasks.has(id)) return id;
    }
    throw new LoopError("LOOP_LIMIT_REACHED", "could not allocate task id");
  }

  private maintenancePrompt(): string {
    return resolveMaintenancePrompt({
      cwd: this.host.getCwd?.() ?? process.cwd(),
      isProjectTrusted: this.host.isProjectTrusted ?? (() => false),
    });
  }

  private toCreateResult(
    task: LoopTask,
    schedule: string,
    adjustment: string | null,
  ): CreateResult {
    return {
      task_id: task.id,
      kind: task.kind,
      schedule,
      next_fire_at: iso(task.nextFireAt),
      expires_at: iso(task.expiresAt),
      pending: task.pendingSince != null && this.inFlight?.taskId !== task.id,
      adjustment,
    };
  }

  private toListItem(task: LoopTask): CronListItem {
    return {
      task_id: task.id,
      kind: task.kind,
      prompt_preview: previewPrompt(task.prompt),
      schedule: scheduleOf(task),
      next_fire_at: iso(task.nextFireAt),
      expires_at: iso(task.expiresAt),
      pending: task.pendingSince != null,
      running: this.inFlight?.taskId === task.id,
    };
  }
}

function scheduleOf(task: LoopTask): string {
  if (task.kind === "recurring") return task.cron;
  if (task.kind === "dynamic") return "dynamic";
  return task.cron ?? iso(task.runAt) ?? "";
}

function compareDue(a: LoopTask, b: LoopTask): number {
  const dt = (a.nextFireAt ?? 0) - (b.nextFireAt ?? 0);
  if (dt !== 0) return dt;
  const created = a.createdAt - b.createdAt;
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
