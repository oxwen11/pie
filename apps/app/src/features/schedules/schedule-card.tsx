import type { Schedule } from "@getpie/contract";
import { Switch } from "@getpie/ui/components/switch";

import { formatNextRun, formatSpec } from "./cadence";
import { useSchedule } from "./schedule-context";
import {
  ScheduleItem,
  ScheduleItemDescription,
  ScheduleItemTitle,
  ScheduleItemTrigger,
} from "./schedule-item";

export type ScheduleCardProps = {
  readonly schedule: Schedule;
  readonly projectName: string;
};

export function ScheduleCard({ schedule, projectName }: ScheduleCardProps) {
  const { state, actions, meta } = useSchedule();
  const selected = schedule.id === state.selectedId;
  return (
    <ScheduleItem
      className={selected ? "bg-accent/50" : undefined}
      data-state={selected ? "selected" : undefined}
    >
      <ScheduleItemTrigger aria-pressed={selected} onClick={() => actions.select(schedule.id)}>
        <ScheduleItemTitle>{schedule.name}</ScheduleItemTitle>
        <ScheduleItemDescription>
          {projectName} · {formatSpec(schedule.spec)}
        </ScheduleItemDescription>
        <ScheduleItemDescription>
          {formatNextRun(
            schedule.nextRunAt,
            schedule.enabled,
            schedule.pauseReason,
            schedule.maxRuns,
          )}
        </ScheduleItemDescription>
      </ScheduleItemTrigger>
      <Switch
        aria-label={schedule.enabled ? "Pause schedule" : "Enable schedule"}
        checked={schedule.enabled}
        className="[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3)]"
        disabled={meta.updating}
        onCheckedChange={(enabled) => actions.toggle(schedule.id, enabled)}
      />
    </ScheduleItem>
  );
}
