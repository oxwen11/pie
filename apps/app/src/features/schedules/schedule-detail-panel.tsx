import { firedRunCount, type Schedule } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";

import {
  formatFiredCap,
  formatLastRun,
  formatNextRun,
  formatRunSummary,
  formatSpec,
  summarizeRuns,
} from "./cadence";
import {
  SchedulePanel,
  SchedulePanelBody,
  SchedulePanelClose,
  SchedulePanelHeader,
  SchedulePanelTitle,
} from "./schedule-panel";
import { ScheduleRunHistory } from "./schedule-run-history";

export type ScheduleDetailPanelProps = {
  readonly schedule: Schedule;
  readonly projectName: string;
  readonly sessionLine: string | null;
  readonly nowMs: number;
  readonly running: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onRunNow: () => void;
  readonly onOpenSession: (sessionId: string) => void;
};

export function ScheduleDetailPanel({
  schedule,
  projectName,
  sessionLine,
  nowMs,
  running,
  onClose,
  onEdit,
  onDelete,
  onRunNow,
  onOpenSession,
}: ScheduleDetailPanelProps) {
  const lastRun = formatLastRun(schedule);
  const summary = formatRunSummary(summarizeRuns(schedule.runs));
  return (
    <SchedulePanel aria-label={schedule.name}>
      <SchedulePanelHeader>
        <SchedulePanelTitle>{schedule.name}</SchedulePanelTitle>
        <SchedulePanelClose onClick={onClose} />
      </SchedulePanelHeader>
      <SchedulePanelBody className="gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">
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
        <div className="flex flex-wrap gap-1">
          <Button disabled={running} onClick={onRunNow} size="sm" variant="ghost">
            Run now
          </Button>
          <Button onClick={onEdit} size="sm" variant="ghost">
            Edit
          </Button>
          <Button onClick={onDelete} size="sm" variant="ghost">
            Delete
          </Button>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Recent runs</h3>
          <ScheduleRunHistory nowMs={nowMs} onOpenSession={onOpenSession} schedule={schedule} />
        </div>
      </SchedulePanelBody>
    </SchedulePanel>
  );
}
