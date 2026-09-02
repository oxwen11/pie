import type { Project, Automation, AutomationSpec } from "@getpie/contract";
import {
  MAX_AUTOMATION_MAX_RUNS,
  MAX_AUTOMATION_NAME_CHARS,
  MAX_AUTOMATION_PROMPT_CHARS,
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
import { useState } from "react";

import {
  CADENCE_OPTIONS,
  EVERY_UNIT_OPTIONS,
  type AutomationFormValues,
  WEEKDAY_OPTIONS,
  defaultOnceLocal,
  defaultAutomationForm,
  formFromSpec,
  isoToLocalDateTime,
  isAutomationCadence,
  isAutomationEveryUnit,
  localDateTimeToIso,
  specFromForm,
} from "./cadence";

export type AutomationFormSubmit = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly spec: AutomationSpec;
  readonly worktree: boolean;
  readonly outputMode: "independent" | "merged";
  readonly expiresAt: string | null;
  readonly maxRuns: number | null;
  readonly runNow: boolean;
};

export type AutomationFormProps = {
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly initial?: Automation;
  readonly submitting?: boolean;
  readonly onSubmit: (value: AutomationFormSubmit) => void;
  readonly onCancel: () => void;
};

function formFromAutomation(
  projects: ReadonlyArray<Pick<Project, "id" | "name">>,
  initial?: Automation,
): AutomationFormValues {
  const projectId = initial?.projectId ?? projects[0]?.id ?? "";
  const base = defaultAutomationForm(projectId);
  if (initial === undefined) return base;
  return {
    ...base,
    name: initial.name,
    prompt: initial.prompt,
    worktree: initial.worktree !== undefined,
    reuseSession: initial.outputMode === "merged",
    expiresAt: initial.expiresAt !== undefined ? isoToLocalDateTime(initial.expiresAt) : "",
    maxRuns: initial.maxRuns !== undefined ? String(initial.maxRuns) : "",
    runNow: false,
    ...formFromSpec(initial.spec, base),
  };
}

export function AutomationForm({
  projects,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: AutomationFormProps) {
  const [form, setForm] = useState(() => formFromAutomation(projects, initial));
  const [error, setError] = useState<string | null>(null);
  const projectLocked = initial !== undefined;
  const creating = initial === undefined;
  const everyAmount = Number(form.everyAmount);
  const maxRunsTrimmed = form.maxRuns.trim();
  const maxRunsNumber = maxRunsTrimmed === "" ? null : Number(maxRunsTrimmed);
  const maxRunsValid =
    maxRunsNumber === null ||
    (Number.isInteger(maxRunsNumber) &&
      maxRunsNumber >= 1 &&
      maxRunsNumber <= MAX_AUTOMATION_MAX_RUNS);
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
            outputMode: form.reuseSession ? "merged" : "independent",
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
        <FieldLabel htmlFor="automation-name">Name</FieldLabel>
        <Input
          id="automation-name"
          maxLength={MAX_AUTOMATION_NAME_CHARS}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          required
          value={form.name}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="automation-project">Project</FieldLabel>
        <Select
          disabled={projectLocked || projects.length === 0}
          items={projects.map((project) => ({ label: project.name, value: project.id }))}
          onValueChange={(next) => {
            if (typeof next === "string") {
              setForm((current) => ({ ...current, projectId: next }));
            }
          }}
          value={form.projectId === "" ? null : form.projectId}
        >
          <SelectTrigger id="automation-project">
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
        <FieldLabel htmlFor="automation-prompt">Prompt</FieldLabel>
        <Textarea
          id="automation-prompt"
          maxLength={MAX_AUTOMATION_PROMPT_CHARS}
          onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
          required
          rows={5}
          value={form.prompt}
        />
      </Field>
      <Field>
        <FieldLabel>Cadence</FieldLabel>
        <Select
          items={CADENCE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          onValueChange={(next) => {
            if (typeof next !== "string" || !isAutomationCadence(next)) return;
            setForm((current) => ({
              ...current,
              cadence: next,
              runAt: next === "once" && current.runAt === "" ? defaultOnceLocal() : current.runAt,
            }));
          }}
          value={form.cadence}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {form.cadence === "every" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="automation-every-amount">Every</FieldLabel>
            <Input
              id="automation-every-amount"
              min={1}
              onChange={(event) =>
                setForm((current) => ({ ...current, everyAmount: event.target.value }))
              }
              required
              type="number"
              value={form.everyAmount}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="automation-every-unit">Unit</FieldLabel>
            <Select
              items={EVERY_UNIT_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              onValueChange={(next) => {
                if (typeof next === "string" && isAutomationEveryUnit(next)) {
                  setForm((current) => ({ ...current, everyUnit: next }));
                }
              }}
              value={form.everyUnit}
            >
              <SelectTrigger id="automation-every-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVERY_UNIT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}
      {form.cadence === "daily" || form.cadence === "weekdays" || form.cadence === "weekly" ? (
        <Field>
          <FieldLabel htmlFor="automation-time">Time</FieldLabel>
          <Input
            id="automation-time"
            onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
            type="time"
            value={form.time}
          />
        </Field>
      ) : null}
      {form.cadence === "weekly" ? (
        <Field>
          <FieldLabel htmlFor="automation-weekday">Weekday</FieldLabel>
          <Select
            items={WEEKDAY_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            onValueChange={(next) => {
              if (typeof next === "string") {
                setForm((current) => ({ ...current, weekday: next }));
              }
            }}
            value={form.weekday}
          >
            <SelectTrigger id="automation-weekday">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {form.cadence === "once" ? (
        <Field>
          <FieldLabel htmlFor="automation-once">Run at</FieldLabel>
          <Input
            id="automation-once"
            onChange={(event) => setForm((current) => ({ ...current, runAt: event.target.value }))}
            required
            type="datetime-local"
            value={form.runAt}
          />
        </Field>
      ) : null}
      {form.cadence === "cron" ? (
        <>
          <Field>
            <FieldLabel htmlFor="automation-cron">Cron</FieldLabel>
            <Input
              id="automation-cron"
              onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
              placeholder="0 9 * * 1-5"
              required
              value={form.cron}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="automation-timezone">Timezone</FieldLabel>
            <Input
              id="automation-timezone"
              onChange={(event) =>
                setForm((current) => ({ ...current, timeZone: event.target.value }))
              }
              placeholder="Leave empty for the server's local timezone"
              value={form.timeZone}
            />
            <FieldDescription>IANA name, for example UTC or America/New_York.</FieldDescription>
          </Field>
        </>
      ) : null}
      <Field>
        <FieldLabel htmlFor="automation-expires">Expires</FieldLabel>
        <Input
          id="automation-expires"
          onChange={(event) =>
            setForm((current) => ({ ...current, expiresAt: event.target.value }))
          }
          type="datetime-local"
          value={form.expiresAt}
        />
        <FieldDescription>Optional. After this time the automation pauses itself.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="automation-max-runs">Stop after N runs</FieldLabel>
        <Input
          id="automation-max-runs"
          max={MAX_AUTOMATION_MAX_RUNS}
          min={1}
          onChange={(event) => setForm((current) => ({ ...current, maxRuns: event.target.value }))}
          placeholder="Unlimited"
          type="number"
          value={form.maxRuns}
        />
        <FieldDescription>
          Optional. After this many fires the automation pauses itself.
        </FieldDescription>
      </Field>
      <Field>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0">
            <FieldLabel htmlFor="automation-reuse">Reuse one session</FieldLabel>
            <FieldDescription>
              Keep sending prompts to the same chat instead of creating a new one.
            </FieldDescription>
          </div>
          <Switch
            checked={form.reuseSession}
            id="automation-reuse"
            onCheckedChange={(checked) =>
              setForm((current) => ({ ...current, reuseSession: checked }))
            }
          />
        </div>
      </Field>
      <Field>
        <div className="flex w-full items-center justify-between gap-3">
          <FieldLabel htmlFor="automation-worktree">Isolated worktree</FieldLabel>
          <Switch
            checked={form.worktree}
            id="automation-worktree"
            onCheckedChange={(checked) => setForm((current) => ({ ...current, worktree: checked }))}
          />
        </div>
      </Field>
      {creating ? (
        <Field>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <FieldLabel htmlFor="automation-run-now">Run now</FieldLabel>
              <FieldDescription>
                Start a session as soon as this automation is created.
              </FieldDescription>
            </div>
            <Switch
              checked={form.runNow}
              id="automation-run-now"
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
