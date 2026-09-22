import { MAX_SCHEDULE_MAX_RUNS } from "@getpie/contract";
import { Field, FieldDescription, FieldLabel } from "@getpie/ui/components/field";
import { Input } from "@getpie/ui/components/input";
import type { Dispatch, SetStateAction } from "react";

import type { ScheduleFormValues } from "./cadence";

export type ScheduleFormLimitsFieldsProps = {
  readonly form: ScheduleFormValues;
  readonly setForm: Dispatch<SetStateAction<ScheduleFormValues>>;
};

export function ScheduleFormLimitsFields({ form, setForm }: ScheduleFormLimitsFieldsProps) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="schedule-expires">Expires</FieldLabel>
        <Input
          id="schedule-expires"
          onChange={(event) =>
            setForm((current) => ({ ...current, expiresAt: event.target.value }))
          }
          type="datetime-local"
          value={form.expiresAt}
        />
        <FieldDescription>Optional. After this time the schedule pauses itself.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="schedule-max-runs">Stop after N runs</FieldLabel>
        <Input
          id="schedule-max-runs"
          max={MAX_SCHEDULE_MAX_RUNS}
          min={1}
          onChange={(event) => setForm((current) => ({ ...current, maxRuns: event.target.value }))}
          placeholder="Unlimited"
          type="number"
          value={form.maxRuns}
        />
        <FieldDescription>
          Optional. After this many fires the schedule pauses itself.
        </FieldDescription>
      </Field>
    </>
  );
}
