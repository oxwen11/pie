import { Field, FieldDescription, FieldLabel } from "@getpie/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { Switch } from "@getpie/ui/components/switch";
import type { Dispatch, SetStateAction } from "react";

import { CREATE_ON_FIRST_RUN_VALUE, type ScheduleFormValues } from "./cadence";

export type ScheduleFormSessionItem = {
  readonly label: string;
  readonly value: string;
};

export type ScheduleFormSessionFieldsProps = {
  readonly form: ScheduleFormValues;
  readonly setForm: Dispatch<SetStateAction<ScheduleFormValues>>;
  readonly selectedSessionValue: string;
  readonly sessionItems: ReadonlyArray<ScheduleFormSessionItem>;
};

export function ScheduleFormSessionFields({
  form,
  setForm,
  selectedSessionValue,
  sessionItems,
}: ScheduleFormSessionFieldsProps) {
  return (
    <>
      <Field>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0">
            <FieldLabel htmlFor="schedule-reuse">Reuse one session</FieldLabel>
            <FieldDescription>
              Keep sending prompts to the same chat instead of creating a new one.
            </FieldDescription>
          </div>
          <Switch
            checked={form.reuseSession}
            id="schedule-reuse"
            onCheckedChange={(checked) =>
              setForm((current) => ({ ...current, reuseSession: checked }))
            }
          />
        </div>
      </Field>
      {form.reuseSession ? (
        <Field>
          <FieldLabel htmlFor="schedule-session">Session</FieldLabel>
          <Select
            disabled={form.projectId.length === 0}
            items={sessionItems}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              if (next === CREATE_ON_FIRST_RUN_VALUE) {
                setForm((current) => ({
                  ...current,
                  sessionPick: "create",
                  sessionId: "",
                }));
                return;
              }
              setForm((current) => ({
                ...current,
                sessionPick: "existing",
                sessionId: next,
              }));
            }}
            value={selectedSessionValue}
          >
            <SelectTrigger id="schedule-session">
              <SelectValue placeholder="Create on first run" />
            </SelectTrigger>
            <SelectContent>
              {sessionItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Create a chat on the first run, or keep prompting an existing one.
          </FieldDescription>
        </Field>
      ) : null}
    </>
  );
}
