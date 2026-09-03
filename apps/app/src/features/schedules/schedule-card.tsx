import type { Schedule } from "@getpie/contract";
import { Switch } from "@getpie/ui/components/switch";
import { cn } from "@getpie/ui/lib/utils";

import { formatNextRun, formatSpec } from "./cadence";

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
    <li>
      <div
        className={cn(
          "hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex items-center gap-6 rounded-lg border p-3",
          selected && "bg-accent/50",
        )}
        data-state={selected ? "selected" : undefined}
      >
        <button
          aria-pressed={selected}
          className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none"
          onClick={onSelect}
          type="button"
        >
          <p className="truncate">{schedule.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {projectName} · {formatSpec(schedule.spec)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {formatNextRun(
              schedule.nextRunAt,
              schedule.enabled,
              schedule.pauseReason,
              schedule.maxRuns,
            )}
          </p>
        </button>
        <Switch
          aria-label={schedule.enabled ? "Pause schedule" : "Enable schedule"}
          checked={schedule.enabled}
          className="[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3)]"
          disabled={updating}
          onCheckedChange={onToggle}
        />
      </div>
    </li>
  );
}
