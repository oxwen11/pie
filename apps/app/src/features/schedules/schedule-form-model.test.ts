import { describe, expect, it } from "vitest";

import { CREATE_ON_FIRST_RUN_VALUE, defaultScheduleForm } from "./cadence";
import {
  parseScheduleMaxRuns,
  scheduleCreateInput,
  scheduleFormCanSubmit,
  scheduleMaxRunsValid,
  scheduleModelOptions,
  scheduleSessionItems,
  scheduleUpdateInput,
} from "./schedule-form-model";

describe("scheduleFormCanSubmit", () => {
  const ready = defaultScheduleForm("proj");

  it("rejects an empty name or prompt", () => {
    expect(
      scheduleFormCanSubmit({
        submitting: false,
        form: { ...ready, name: "Nightly", prompt: "hi" },
        everyAmount: 1,
        maxRunsValid: true,
        hasModel: true,
      }),
    ).toBe(true);
    expect(
      scheduleFormCanSubmit({
        submitting: false,
        form: ready,
        everyAmount: 1,
        maxRunsValid: true,
        hasModel: true,
      }),
    ).toBe(false);
  });

  it("requires once/cron/every fields for those cadences", () => {
    expect(
      scheduleFormCanSubmit({
        submitting: false,
        form: { ...ready, name: "Once", prompt: "hi", cadence: "once", runAt: "" },
        everyAmount: 1,
        maxRunsValid: true,
        hasModel: true,
      }),
    ).toBe(false);
    expect(
      scheduleFormCanSubmit({
        submitting: false,
        form: { ...ready, name: "Cron", prompt: "hi", cadence: "cron", cron: "" },
        everyAmount: 1,
        maxRunsValid: true,
        hasModel: true,
      }),
    ).toBe(false);
    expect(
      scheduleFormCanSubmit({
        submitting: false,
        form: { ...ready, name: "Every", prompt: "hi", cadence: "every" },
        everyAmount: 0.5,
        maxRunsValid: true,
        hasModel: true,
      }),
    ).toBe(false);
  });
});

describe("schedule session and model helpers", () => {
  it("parses max runs and keeps an orphan selected session", () => {
    expect(parseScheduleMaxRuns("")).toBeNull();
    expect(parseScheduleMaxRuns("3")).toBe(3);
    expect(scheduleMaxRunsValid(0)).toBe(false);
    expect(scheduleMaxRunsValid(3)).toBe(true);
    expect(scheduleSessionItems([], CREATE_ON_FIRST_RUN_VALUE)).toEqual([
      { label: "Create on first run", value: CREATE_ON_FIRST_RUN_VALUE },
    ]);
    expect(scheduleSessionItems([{ sessionId: "s1", title: "Nightly" }], "missing")).toEqual([
      { label: "Create on first run", value: CREATE_ON_FIRST_RUN_VALUE },
      { label: "Nightly", value: "s1" },
      { label: "Selected session", value: "missing" },
    ]);
  });

  it("appends a picked model that is not in the list", () => {
    const listed = [{ provider: "openai", modelId: "gpt" }];
    const extra = { provider: "anthropic", modelId: "claude" };
    expect(scheduleModelOptions(listed, extra)).toEqual([...listed, extra]);
    expect(scheduleModelOptions(listed, listed[0])).toEqual(listed);
  });

  it("maps create and update payloads", () => {
    const spec = { kind: "manual" as const };
    const session = { policy: "isolated" as const };
    expect(
      scheduleCreateInput({
        name: "Nightly",
        projectId: "proj",
        prompt: "hi",
        spec,
        worktree: true,
        session,
        expiresAt: null,
        maxRuns: 2,
        runNow: true,
        provider: "openai",
        modelId: "gpt",
      }),
    ).toEqual({
      name: "Nightly",
      projectId: "proj",
      prompt: "hi",
      spec,
      session,
      maxRuns: 2,
      runNow: true,
      worktree: {},
      provider: "openai",
      modelId: "gpt",
    });
    expect(scheduleUpdateInput({ id: "sched-1", enabled: false, worktree: false })).toEqual({
      id: "sched-1",
      enabled: false,
    });
  });
});
