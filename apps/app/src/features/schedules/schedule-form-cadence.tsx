import { Field, FieldDescription, FieldLabel } from "@getpie/ui/components/field";
import { Input } from "@getpie/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import type { Dispatch, SetStateAction } from "react";

import {
  CADENCE_OPTIONS,
  EVERY_UNIT_OPTIONS,
  type ScheduleFormValues,
  WEEKDAY_OPTIONS,
  defaultOnceLocal,
  isScheduleCadence,
  isScheduleEveryUnit,
} from "./cadence";

export type ScheduleFormCadenceFieldsProps = {
  readonly form: ScheduleFormValues;
  readonly setForm: Dispatch<SetStateAction<ScheduleFormValues>>;
};

export function ScheduleFormCadenceFields({ form, setForm }: ScheduleFormCadenceFieldsProps) {
  return (
    <>
      <Field>
        <FieldLabel>Cadence</FieldLabel>
        <Select
          items={CADENCE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          onValueChange={(next) => {
            if (typeof next !== "string" || !isScheduleCadence(next)) return;
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
            <FieldLabel htmlFor="schedule-every-amount">Every</FieldLabel>
            <Input
              id="schedule-every-amount"
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
            <FieldLabel htmlFor="schedule-every-unit">Unit</FieldLabel>
            <Select
              items={EVERY_UNIT_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              onValueChange={(next) => {
                if (typeof next === "string" && isScheduleEveryUnit(next)) {
                  setForm((current) => ({ ...current, everyUnit: next }));
                }
              }}
              value={form.everyUnit}
            >
              <SelectTrigger id="schedule-every-unit">
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
          <FieldLabel htmlFor="schedule-time">Time</FieldLabel>
          <Input
            id="schedule-time"
            onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
            type="time"
            value={form.time}
          />
        </Field>
      ) : null}
      {form.cadence === "weekly" ? (
        <Field>
          <FieldLabel htmlFor="schedule-weekday">Weekday</FieldLabel>
          <Select
            items={WEEKDAY_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            onValueChange={(next) => {
              if (typeof next === "string") {
                setForm((current) => ({ ...current, weekday: next }));
              }
            }}
            value={form.weekday}
          >
            <SelectTrigger id="schedule-weekday">
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
          <FieldLabel htmlFor="schedule-once">Run at</FieldLabel>
          <Input
            id="schedule-once"
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
            <FieldLabel htmlFor="schedule-cron">Cron</FieldLabel>
            <Input
              id="schedule-cron"
              onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
              placeholder="0 9 * * 1-5"
              required
              value={form.cron}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-timezone">Timezone</FieldLabel>
            <Input
              id="schedule-timezone"
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
    </>
  );
}
