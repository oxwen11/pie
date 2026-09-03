import type { Project, Schedule, ScheduleSession, ScheduleSpec } from "@getpie/contract";
import {
  scheduleSessionOf,
  MAX_SCHEDULE_MAX_RUNS,
  MAX_SCHEDULE_NAME_CHARS,
  MAX_SCHEDULE_PROMPT_CHARS,
  reuseSessionIdOf,
} from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@getpie/ui/components/field";
import { Input } from "@getpie/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { Switch } from "@getpie/ui/components/switch";
import { Textarea } from "@getpie/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import {
  CREATE_ON_FIRST_RUN_VALUE,
  type ScheduleFormValues,
  defaultScheduleForm,
  formFromSpec,
  isoToLocalDateTime,
  localDateTimeToIso,
  sessionFromForm,
  sessionSelectValue,
  specFromForm,
} from "./cadence";
import { ScheduleFormCadenceFields } from "./schedule-form-cadence";
import { ScheduleFormLimitsFields } from "./schedule-form-limits";
import { ScheduleFormSessionFields } from "./schedule-form-session";
import { ScheduleModelSelect } from "./schedule-model-select";

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

export type ScheduleFormDefaults = {
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type ScheduleFormProps = {
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly initial?: Schedule;
  readonly defaults?: ScheduleFormDefaults;
  readonly submitting?: boolean;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
  readonly onCancel: () => void;
};

function formFromSchedule(
  projects: ReadonlyArray<Pick<Project, "id" | "name">>,
  initial?: Schedule,
  defaults?: ScheduleFormDefaults,
): ScheduleFormValues {
  const projectId = initial?.projectId ?? defaults?.projectId ?? projects[0]?.id ?? "";
  const base = defaultScheduleForm(projectId);
  if (initial === undefined) {
    const sessionId = defaults?.sessionId ?? "";
    if (sessionId === "") return base;
    return {
      ...base,
      reuseSession: true,
      sessionPick: "existing",
      sessionId,
    };
  }
  const session = scheduleSessionOf(initial);
  const boundId = reuseSessionIdOf(session);
  return {
    ...base,
    name: initial.name,
    prompt: initial.prompt,
    worktree: initial.worktree !== undefined,
    reuseSession: session.policy !== "isolated",
    sessionPick: boundId !== undefined ? "existing" : "create",
    sessionId: boundId ?? "",
    expiresAt: initial.expiresAt !== undefined ? isoToLocalDateTime(initial.expiresAt) : "",
    maxRuns: initial.maxRuns !== undefined ? String(initial.maxRuns) : "",
    runNow: false,
    model:
      initial.provider !== undefined && initial.modelId !== undefined
        ? { provider: initial.provider, modelId: initial.modelId }
        : undefined,
    ...formFromSpec(initial.spec, base),
  };
}

export function ScheduleForm({
  projects,
  initial,
  defaults,
  submitting = false,
  onSubmit,
  onCancel,
}: ScheduleFormProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const [form, setForm] = useState(() => formFromSchedule(projects, initial, defaults));
  const [error, setError] = useState<string | null>(null);
  const projectLocked = initial !== undefined;
  const creating = initial === undefined;
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: form.projectId, archived: false },
    }),
    enabled: form.reuseSession && form.projectId.length > 0,
  });
  const models = useQuery({
    ...orpcQueryUtils.agent.listModels.queryOptions({ input: { projectId: form.projectId } }),
    enabled: form.projectId.length > 0,
  });
  const listedModels = models.data?.models ?? [];
  const model = form.model ?? models.data?.defaultModel;
  const modelOptions =
    model !== undefined &&
    !listedModels.some((item) => item.provider === model.provider && item.modelId === model.modelId)
      ? [...listedModels, model]
      : listedModels;
  const listed = sessions.data ?? [];
  const listedIds = sessions.isSuccess
    ? new Set(listed.map((session) => session.sessionId))
    : undefined;
  const selectedSessionValue = sessionSelectValue(form, listedIds);
  const sessionItems = [
    { label: "Create on first run", value: CREATE_ON_FIRST_RUN_VALUE },
    ...listed.map((session) => ({
      label: session.title ?? "New chat",
      value: session.sessionId,
    })),
    ...(selectedSessionValue !== CREATE_ON_FIRST_RUN_VALUE &&
    !listed.some((session) => session.sessionId === selectedSessionValue)
      ? [{ label: "Selected session", value: selectedSessionValue }]
      : []),
  ];
  const everyAmount = Number(form.everyAmount);
  const maxRunsTrimmed = form.maxRuns.trim();
  const maxRunsNumber = maxRunsTrimmed === "" ? null : Number(maxRunsTrimmed);
  const maxRunsValid =
    maxRunsNumber === null ||
    (Number.isInteger(maxRunsNumber) &&
      maxRunsNumber >= 1 &&
      maxRunsNumber <= MAX_SCHEDULE_MAX_RUNS);
  const canSubmit =
    !submitting &&
    maxRunsValid &&
    form.name.trim().length > 0 &&
    form.projectId.length > 0 &&
    form.prompt.trim().length > 0 &&
    (form.cadence !== "once" || form.runAt.length > 0) &&
    (form.cadence !== "cron" || form.cron.trim().length > 0) &&
    (form.cadence !== "every" || (Number.isInteger(everyAmount) && everyAmount >= 1)) &&
    (listedModels.length === 0 || model !== undefined);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        try {
          const spec = specFromForm({
            ...form,
            name: form.name.trim(),
            prompt: form.prompt.trim(),
            cron: form.cron.trim(),
          });
          setError(null);
          onSubmit({
            name: form.name.trim(),
            projectId: form.projectId,
            prompt: form.prompt.trim(),
            spec,
            worktree: form.worktree,
            session: sessionFromForm(form, listedIds),
            expiresAt: form.expiresAt === "" ? null : localDateTimeToIso(form.expiresAt),
            maxRuns: maxRunsNumber,
            runNow: creating && form.runNow,
            ...(model !== undefined
              ? { provider: model.provider, modelId: model.modelId }
              : undefined),
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
        <Input
          id="schedule-name"
          maxLength={MAX_SCHEDULE_NAME_CHARS}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          required
          value={form.name}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="schedule-project">Project</FieldLabel>
        <Select
          disabled={projectLocked || projects.length === 0}
          items={projects.map((project) => ({ label: project.name, value: project.id }))}
          onValueChange={(next) => {
            if (typeof next === "string") {
              setForm((current) => ({
                ...current,
                projectId: next,
                sessionPick: "create",
                sessionId: "",
                model: undefined,
              }));
            }
          }}
          value={form.projectId === "" ? null : form.projectId}
        >
          <SelectTrigger id="schedule-project">
            <SelectValue placeholder="Select a project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="schedule-model">Model</FieldLabel>
        <ScheduleModelSelect
          modelId={model?.modelId}
          models={modelOptions}
          onChange={(provider, modelId) =>
            setForm((current) => ({ ...current, model: { provider, modelId } }))
          }
          providerId={model?.provider}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="schedule-prompt">Prompt</FieldLabel>
        <Textarea
          id="schedule-prompt"
          maxLength={MAX_SCHEDULE_PROMPT_CHARS}
          onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
          required
          rows={5}
          value={form.prompt}
        />
      </Field>
      <ScheduleFormCadenceFields form={form} setForm={setForm} />
      <ScheduleFormLimitsFields form={form} setForm={setForm} />
      <ScheduleFormSessionFields
        form={form}
        selectedSessionValue={selectedSessionValue}
        sessionItems={sessionItems}
        setForm={setForm}
      />
      <Field>
        <div className="flex w-full items-center justify-between gap-3">
          <FieldLabel htmlFor="schedule-worktree">Isolated worktree</FieldLabel>
          <Switch
            checked={form.worktree}
            id="schedule-worktree"
            onCheckedChange={(checked) => setForm((current) => ({ ...current, worktree: checked }))}
          />
        </div>
      </Field>
      {creating ? (
        <Field>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <FieldLabel htmlFor="schedule-run-now">Run now</FieldLabel>
              <FieldDescription>
                Start a session as soon as this schedule is created.
              </FieldDescription>
            </div>
            <Switch
              checked={form.runNow}
              id="schedule-run-now"
              onCheckedChange={(checked) => setForm((current) => ({ ...current, runNow: checked }))}
            />
          </div>
        </Field>
      ) : null}
      {error !== null ? <FieldError>{error}</FieldError> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={!canSubmit} type="submit">
          {initial === undefined ? "Create" : "Save"}
        </Button>
      </div>
    </form>
  );
}
