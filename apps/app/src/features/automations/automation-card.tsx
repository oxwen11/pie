import { firedRunCount, type Automation } from "@getpie/contract";
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

export type AutomationCardProps = {
  readonly automation: Automation;
  readonly projectName: string;
  readonly updating: boolean;
  readonly running: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onRunNow: () => void;
  readonly onHistory: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

export function AutomationCard({
  automation,
  projectName,
  updating,
  running,
  onToggle,
  onRunNow,
  onHistory,
  onEdit,
  onDelete,
}: AutomationCardProps) {
  const lastRun = formatLastRun(automation);
  const summary = formatRunSummary(summarizeRuns(automation.runs));
  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{automation.name}</div>
          <div className="text-muted-foreground truncate text-sm">
            {projectName} · {formatSpec(automation.spec)}
          </div>
          <div className="text-muted-foreground text-sm">
            {formatNextRun(
              automation.nextRunAt,
              automation.enabled,
              automation.pauseReason,
              automation.maxRuns,
            )}
          </div>
          {automation.maxRuns !== undefined ? (
            <div className="text-muted-foreground text-sm">
              {formatFiredCap(firedRunCount(automation), automation.maxRuns)}
            </div>
          ) : null}
          {lastRun !== null ? <div className="text-muted-foreground text-sm">{lastRun}</div> : null}
          {summary !== null ? <div className="text-muted-foreground text-sm">{summary}</div> : null}
        </div>
        <Switch
          aria-label={automation.enabled ? "Pause automation" : "Enable automation"}
          checked={automation.enabled}
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
