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
};

export type ScheduleFormDefaults = {
  readonly projectId?: string;
  readonly sessionId?: string;
};

type ScheduleFormSource =
  | { readonly kind: "create"; readonly defaults?: ScheduleFormDefaults }
  | { readonly kind: "edit"; readonly schedule: Schedule };

type ScheduleFormFieldsProps = {
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly source: ScheduleFormSource;
  readonly submitting?: boolean;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
  readonly onCancel: () => void;
};

export type ScheduleCreateFormProps = {
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly defaults?: ScheduleFormDefaults;
  readonly submitting?: boolean;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
  readonly onCancel: () => void;
};

export type ScheduleEditFormProps = {
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly schedule: Schedule;
  readonly submitting?: boolean;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
  readonly onCancel: () => void;
};

function formFromSource(
  projects: ReadonlyArray<Pick<Project, "id" | "name">>,
  source: ScheduleFormSource,
): ScheduleFormValues {
  if (source.kind === "create") {
    const projectId = source.defaults?.projectId ?? projects[0]?.id ?? "";
    const base = defaultScheduleForm(projectId);
    const sessionId = source.defaults?.sessionId ?? "";
    if (sessionId === "") return base;
    return {
      ...base,
      reuseSession: true,
      sessionPick: "existing",
      sessionId,
    };
  }
  const schedule = source.schedule;
  const base = defaultScheduleForm(schedule.projectId);
  const session = scheduleSessionOf(schedule);
  const boundId = reuseSessionIdOf(session);
  return {
    ...base,
    name: schedule.name,
    prompt: schedule.prompt,
    worktree: schedule.worktree !== undefined,
    reuseSession: session.policy !== "isolated",
    sessionPick: boundId !== undefined ? "existing" : "create",
    sessionId: boundId ?? "",
    expiresAt: schedule.expiresAt !== undefined ? isoToLocalDateTime(schedule.expiresAt) : "",
    maxRuns: schedule.maxRuns !== undefined ? String(schedule.maxRuns) : "",
    runNow: false,
    ...formFromSpec(schedule.spec, base),
  };
}

function ScheduleFormFields({
  projects,
  source,
  submitting = false,
  onSubmit,
  onCancel,
}: ScheduleFormFieldsProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const [form, setForm] = useState(() => formFromSource(projects, source));
  const [error, setError] = useState<string | null>(null);
  const projectLocked = source.kind === "edit";
  const creating = source.kind === "create";
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: form.projectId, archived: false },
    }),
    enabled: form.reuseSession && form.projectId.length > 0,
  });
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
    (form.cadence !== "every" || (Number.isInteger(everyAmount) && everyAmount >= 1));

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
          {creating ? "Create" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function ScheduleCreateForm({
  projects,
  defaults,
  submitting,
  onSubmit,
  onCancel,
}: ScheduleCreateFormProps) {
  return (
    <ScheduleFormFields
      onCancel={onCancel}
      onSubmit={onSubmit}
      projects={projects}
      source={{ kind: "create", defaults }}
      submitting={submitting}
    />
  );
}

export function ScheduleEditForm({
  projects,
  schedule,
  submitting,
  onSubmit,
  onCancel,
}: ScheduleEditFormProps) {
  return (
    <ScheduleFormFields
      onCancel={onCancel}
      onSubmit={onSubmit}
      projects={projects}
      source={{ kind: "edit", schedule }}
      submitting={submitting}
    />
  );
}
