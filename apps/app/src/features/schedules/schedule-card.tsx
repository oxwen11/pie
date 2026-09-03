import { firedRunCount, type Schedule } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { Switch } from "@getpie/ui/components/switch";

import {
  formatFiredCap,
  formatLastRun,
  formatNextRun,
  formatRunSummary,
  formatSpec,
  summarizeRuns,
} from "./cadence";

export type ScheduleCardProps = {
  readonly schedule: Schedule;
  readonly projectName: string;
  readonly sessionLine: string | null;
  readonly updating: boolean;
  readonly running: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onRunNow: () => void;
  readonly onHistory: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

export function ScheduleCard({
  schedule,
  projectName,
  sessionLine,
  updating,
  running,
  onToggle,
  onRunNow,
  onHistory,
  onEdit,
  onDelete,
}: ScheduleCardProps) {
  const lastRun = formatLastRun(schedule);
  const summary = formatRunSummary(summarizeRuns(schedule.runs));
  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
          {sessionLine !== null ? (
            <div className="text-muted-foreground text-sm">{sessionLine}</div>
          ) : null}
          {schedule.maxRuns !== undefined ? (
            <div className="text-muted-foreground text-sm">
              {formatFiredCap(firedRunCount(schedule), schedule.maxRuns)}
            </div>
          ) : null}
          {lastRun !== null ? <div className="text-muted-foreground text-sm">{lastRun}</div> : null}
          {summary !== null ? <div className="text-muted-foreground text-sm">{summary}</div> : null}
        </div>
        <Switch
          aria-label={schedule.enabled ? "Pause schedule" : "Enable schedule"}
          checked={schedule.enabled}
          disabled={updating}
          onCheckedChange={onToggle}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <Button disabled={running} onClick={onRunNow} size="sm" variant="ghost">
          Run now
        </Button>
        <Button onClick={onHistory} size="sm" variant="ghost">
          History
        </Button>
        <Button onClick={onEdit} size="sm" variant="ghost">
          Edit
        </Button>
        <Button onClick={onDelete} size="sm" variant="ghost">
          Delete
        </Button>
      </div>
    </li>
  );
}
