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
    <li
      className={cn(
        "border-border bg-card rounded-xl border",
        selected && "border-foreground/30 bg-muted/40",
      )}
      data-state={selected ? "selected" : undefined}
    >
      <div className="flex items-start">
        <button
          aria-pressed={selected}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-s-xl p-4 text-left focus-visible:ring-2 focus-visible:outline-none"
          onClick={onSelect}
          type="button"
        >
          <div className="truncate font-medium">{schedule.name}</div>
          <div className="text-muted-foreground truncate text-sm">
            {projectName} · {formatSpec(schedule.spec)}
          </div>
          <div className="text-muted-foreground text-sm">
            {formatNextRun(
              schedule.nextRunAt,
              schedule.enabled,
              schedule.pauseReason,
              schedule.maxRuns,
            )}
          </div>
        </button>
        <div className="p-4 ps-0">
          <Switch
            aria-label={schedule.enabled ? "Pause schedule" : "Enable schedule"}
            checked={schedule.enabled}
            disabled={updating}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
    </li>
  );
}
