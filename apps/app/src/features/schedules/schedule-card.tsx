import type { Schedule } from "@getpie/contract";
import { Switch } from "@getpie/ui/components/switch";

import { formatNextRun, formatSpec } from "./cadence";
import {
  ScheduleItem,
  ScheduleItemDescription,
  ScheduleItemTitle,
  ScheduleItemTrigger,
} from "./schedule-item";

export type ScheduleCardProps = {
  readonly schedule: Schedule;
  readonly projectName: string;
  readonly selected: boolean;
  readonly updating: boolean;
  readonly onSelect: () => void;
  readonly onToggle: (enabled: boolean) => void;
};

export function ScheduleCard({
  schedule,
  projectName,
  selected,
  updating,
  onSelect,
  onToggle,
}: ScheduleCardProps) {
  return (
    <ScheduleItem
      className={selected ? "bg-accent/50" : undefined}
      data-state={selected ? "selected" : undefined}
    >
      <ScheduleItemTrigger aria-pressed={selected} onClick={onSelect}>
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
        disabled={updating}
        onCheckedChange={onToggle}
      />
    </ScheduleItem>
  );
}
