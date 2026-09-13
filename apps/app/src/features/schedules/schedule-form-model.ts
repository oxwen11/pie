import type {
  CreateScheduleInput,
  ScheduleSession,
  ScheduleSpec,
  UpdateScheduleInput,
} from "@getpie/contract";
import { MAX_SCHEDULE_MAX_RUNS } from "@getpie/contract";

import { CREATE_ON_FIRST_RUN_VALUE, type ScheduleFormValues } from "./cadence";

export type ScheduleFormSubmit = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly spec: ScheduleSpec;
  readonly worktree: boolean;
  readonly session: ScheduleSession;
  readonly expiresAt: string | null;
  readonly maxRuns: number | null;
  readonly runNow: boolean;
  readonly provider?: string;
  readonly modelId?: string;
};

type ScheduleSessionItem = {
  readonly label: string;
  readonly value: string;
};

export function parseScheduleMaxRuns(maxRuns: string): number | null {
  const trimmed = maxRuns.trim();
  return trimmed === "" ? null : Number(trimmed);
}

export function scheduleMaxRunsValid(maxRunsNumber: number | null): boolean {
  return (
    maxRunsNumber === null ||
    (Number.isInteger(maxRunsNumber) &&
      maxRunsNumber >= 1 &&
      maxRunsNumber <= MAX_SCHEDULE_MAX_RUNS)
  );
}

export function scheduleFormCanSubmit({
  submitting,
  form,
  everyAmount,
  maxRunsValid,
  hasModel,
}: {
  readonly submitting: boolean;
  readonly form: ScheduleFormValues;
  readonly everyAmount: number;
  readonly maxRunsValid: boolean;
  readonly hasModel: boolean;
}): boolean {
  if (submitting || !maxRunsValid) return false;
  if (form.name.trim().length === 0) return false;
  if (form.projectId.length === 0) return false;
  if (form.prompt.trim().length === 0) return false;
  if (form.cadence === "once" && form.runAt.length === 0) return false;
  if (form.cadence === "cron" && form.cron.trim().length === 0) return false;
  if (form.cadence === "every" && !(Number.isInteger(everyAmount) && everyAmount >= 1)) {
    return false;
  }
  return hasModel;
}

export function scheduleSessionItems(
  listed: ReadonlyArray<{ readonly sessionId: string; readonly title?: string | null }>,
  selectedSessionValue: string,
): ScheduleSessionItem[] {
  const selectedListed = listed.some((session) => session.sessionId === selectedSessionValue);
  const orphan =
    selectedSessionValue !== CREATE_ON_FIRST_RUN_VALUE && !selectedListed
      ? [{ label: "Selected session", value: selectedSessionValue }]
      : [];
  return [
    { label: "Create on first run", value: CREATE_ON_FIRST_RUN_VALUE },
    ...listed.map((session) => ({
      label: session.title ?? "New chat",
      value: session.sessionId,
    })),
    ...orphan,
  ];
}

export function scheduleModelOptions<
  T extends { readonly provider: string; readonly modelId: string },
>(listedModels: readonly T[], model: T | undefined): readonly T[] {
  if (model === undefined) return listedModels;
  const present = listedModels.some(
    (item) => item.provider === model.provider && item.modelId === model.modelId,
  );
  return present ? listedModels : [...listedModels, model];
}

export function scheduleCreateInput(value: ScheduleFormSubmit): CreateScheduleInput {
  return {
    name: value.name,
    projectId: value.projectId,
    prompt: value.prompt,
    spec: value.spec,
    session: value.session,
    ...(value.expiresAt !== null ? { expiresAt: value.expiresAt } : undefined),
    ...(value.maxRuns !== null ? { maxRuns: value.maxRuns } : undefined),
    ...(value.runNow ? { runNow: true } : undefined),
    ...(value.worktree ? { worktree: {} } : undefined),
    ...(value.provider !== undefined && value.modelId !== undefined
      ? { provider: value.provider, modelId: value.modelId }
      : undefined),
  };
}

export function scheduleUpdateInput(
  input: { readonly id: string } & Partial<ScheduleFormSubmit> & {
      readonly enabled?: boolean;
    },
): UpdateScheduleInput {
  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : undefined),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : undefined),
    ...(input.spec !== undefined ? { spec: input.spec } : undefined),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : undefined),
    ...(input.session !== undefined ? { session: input.session } : undefined),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
    ...(input.worktree === true ? { worktree: {} } : undefined),
    ...(input.provider !== undefined ? { provider: input.provider } : undefined),
    ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
  };
}
