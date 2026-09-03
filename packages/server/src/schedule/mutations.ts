import type {
  CreateScheduleInput,
  CreateWorktreeInput,
  Schedule,
  UpdateScheduleInput,
} from "@getpie/contract";
import {
  MAX_SCHEDULES,
  persistScheduleSession,
  reachedMaxRuns,
  scheduleSessionOf,
} from "@getpie/contract";
import { Clock, Effect } from "effect";

import { ScheduleLimitReached } from "../errors";
import { ProjectService } from "../project";
import { fire } from "./fire";
import { iso, nextWakeDelayMs } from "./next-run";
import { ScheduleRepository } from "./repository";
import { compareSchedules, tryNextRun, tryValidate } from "./run-record";
import { logSchedule, newScheduleId, ScheduleRuntime } from "./runtime";
import { trySession } from "./session";

export const list = () =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const schedules = yield* repo.list();
    return Array.from(schedules).sort(compareSchedules);
  });

export const get = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    return yield* repo.read(id);
  });

export const create = (input: CreateScheduleInput) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const projects = yield* ProjectService;
    yield* projects.findById(input.projectId);
    yield* trySession(input.projectId, input.session);
    const createdAt = yield* Clock.currentTimeMillis;
    yield* tryValidate(input.spec, createdAt, input.expiresAt);
    const existing = yield* repo.list();
    if (existing.length >= MAX_SCHEDULES) {
      return yield* Effect.fail(new ScheduleLimitReached({ limit: MAX_SCHEDULES }));
    }
    const id = yield* newScheduleId;
    const next = yield* tryNextRun(input.spec, id, createdAt);
    const createdIso = new Date(createdAt).toISOString();
    const worktree: CreateWorktreeInput | undefined = input.worktree;
    const schedule: Schedule = {
      id,
      name: input.name,
      projectId: input.projectId,
      prompt: input.prompt,
      spec: input.spec,
      enabled: input.enabled ?? true,
      createdAt: createdIso,
      updatedAt: createdIso,
      nextRunAt: iso(next),
      runs: [],
      ...persistScheduleSession(input.session),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
      ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
      ...(worktree !== undefined ? { worktree } : undefined),
      ...(input.provider !== undefined ? { provider: input.provider } : undefined),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
    };
    yield* repo.write(schedule);
    yield* logSchedule({
      event: "schedule.created",
      message: "schedule created",
      annotations: {
        scheduleId: id,
        specKind: input.spec.kind,
        sessionPolicy: scheduleSessionOf(schedule).policy,
        ...(input.runNow === true ? { runNow: true } : undefined),
      },
    });
    if (input.runNow === true) {
      const fired = yield* fire(schedule, "manual");
      return fired.schedule;
    }
    return schedule;
  });

export const update = (input: UpdateScheduleInput) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const current = yield* repo.read(input.id);
    const {
      pauseReason: _pauseReason,
      expiresAt: _expiresAt,
      maxRuns: _maxRuns,
      session: currentSession,
      provider: _currentProvider,
      modelId: _currentModelId,
      ...currentRest
    } = current;
    const updatedAt = yield* Clock.currentTimeMillis;
    const spec = input.spec ?? current.spec;
    const expiresAt =
      input.expiresAt === undefined
        ? current.expiresAt
        : input.expiresAt === null
          ? undefined
          : input.expiresAt;
    const maxRuns =
      input.maxRuns === undefined
        ? current.maxRuns
        : input.maxRuns === null
          ? undefined
          : input.maxRuns;
    if (input.session !== undefined) {
      yield* trySession(current.projectId, input.session);
    }
    if (input.spec !== undefined || input.expiresAt !== undefined || input.enabled === true) {
      yield* tryValidate(spec, updatedAt, expiresAt);
    }
    const next = yield* tryNextRun(spec, current.id, updatedAt);
    const worktree = input.worktree ?? current.worktree;
    const provider =
      input.provider === undefined
        ? current.provider
        : input.provider === null
          ? undefined
          : input.provider;
    const modelId =
      input.modelId === undefined
        ? current.modelId
        : input.modelId === null
          ? undefined
          : input.modelId;
    const enabled = input.enabled ?? current.enabled;
    const session = input.session ?? currentSession;
    const updated: Schedule = {
      ...currentRest,
      name: input.name ?? current.name,
      prompt: input.prompt ?? current.prompt,
      spec,
      enabled,
      updatedAt: new Date(updatedAt).toISOString(),
      nextRunAt: enabled ? iso(next) : current.nextRunAt,
      ...persistScheduleSession(session),
      ...(expiresAt !== undefined ? { expiresAt } : undefined),
      ...(maxRuns !== undefined ? { maxRuns } : undefined),
      ...(worktree !== undefined ? { worktree } : undefined),
      ...(provider !== undefined ? { provider } : undefined),
      ...(modelId !== undefined ? { modelId } : undefined),
      ...(input.enabled === true
        ? { consecutiveFailures: 0 }
        : input.enabled === false
          ? { pauseReason: "manual" as const }
          : current.pauseReason !== undefined
            ? { pauseReason: current.pauseReason }
            : undefined),
    };
    const atCapPause = reachedMaxRuns(updated) && updated.enabled;
    const persisted = atCapPause
      ? {
          ...updated,
          enabled: false,
          nextRunAt: null,
          pauseReason: "max_runs" as const,
        }
      : updated;
    yield* repo.write(persisted);
    yield* logSchedule({
      event: atCapPause
        ? "schedule.paused"
        : input.enabled === true
          ? "schedule.enabled"
          : input.enabled === false
            ? "schedule.paused"
            : "schedule.updated",
      message: atCapPause
        ? "schedule paused"
        : input.enabled === true
          ? "schedule enabled"
          : input.enabled === false
            ? "schedule paused"
            : "schedule updated",
      annotations: {
        scheduleId: input.id,
        ...(input.enabled !== undefined ? { enabled: persisted.enabled } : undefined),
        ...(atCapPause
          ? { pauseReason: "max_runs" }
          : input.enabled === false
            ? { pauseReason: "manual" }
            : undefined),
        ...(input.spec !== undefined ? { specKind: spec.kind } : undefined),
      },
    });
    return persisted;
  });

export const remove = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    yield* repo.read(id);
    yield* repo.remove(id);
    yield* logSchedule({
      event: "schedule.deleted",
      message: "schedule deleted",
      annotations: { scheduleId: id },
    });
  });

export const runNow = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const schedule = yield* repo.read(id);
    return yield* fire(schedule, "manual");
  });

export const recover = () =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const runtime = yield* ScheduleRuntime;
    const tickedAt = yield* Clock.currentTimeMillis;
    const finishedAt = new Date(tickedAt).toISOString();
    const schedules = yield* repo.list();
    let recovered = 0;
    yield* Effect.forEach(
      schedules,
      (schedule) => {
        const dirty = schedule.runs.some((run) => run.status === "running");
        if (!dirty) return Effect.void;
        recovered += 1;
        const next: Schedule = {
          ...schedule,
          updatedAt: finishedAt,
          lastRunStatus: "interrupted",
          lastError: "app-exit",
          runs: schedule.runs.map((run) =>
            run.status === "running"
              ? { ...run, status: "interrupted" as const, finishedAt, error: "app-exit" }
              : run,
          ),
        };
        runtime.inFlight.delete(schedule.id);
        return repo.write(next);
      },
      { concurrency: 1, discard: true },
    );
    if (recovered > 0) {
      yield* logSchedule({
        event: "schedule.recovered",
        message: "schedule leftover runs marked interrupted",
        annotations: { recovered },
      });
    }
  });

export const nextWakeDelay = () =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const tickedAt = yield* Clock.currentTimeMillis;
    const schedules = yield* repo.list();
    const times: Array<number | null> = [];
    for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      times.push(schedule.nextRunAt === null ? null : Date.parse(schedule.nextRunAt));
      if (schedule.expiresAt !== undefined) times.push(Date.parse(schedule.expiresAt));
    }
    return nextWakeDelayMs(times, tickedAt);
  });
