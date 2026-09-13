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
  ScheduleDetailActions,
  ScheduleDetailDescription,
  ScheduleDetailHistory,
  ScheduleDetailLine,
} from "./schedule-detail";
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
        <ScheduleDetailDescription>
          <ScheduleDetailLine>
            {projectName} · {formatSpec(schedule.spec)}
          </ScheduleDetailLine>
          <ScheduleDetailLine>
            {formatNextRun(
              schedule.nextRunAt,
              schedule.enabled,
              schedule.pauseReason,
              schedule.maxRuns,
            )}
          </ScheduleDetailLine>
          {sessionLine !== null ? <ScheduleDetailLine>{sessionLine}</ScheduleDetailLine> : null}
          {schedule.maxRuns !== undefined ? (
            <ScheduleDetailLine>
              {formatFiredCap(firedRunCount(schedule), schedule.maxRuns)}
            </ScheduleDetailLine>
          ) : null}
          {lastRun !== null ? <ScheduleDetailLine>{lastRun}</ScheduleDetailLine> : null}
          {summary !== null ? <ScheduleDetailLine>{summary}</ScheduleDetailLine> : null}
        </ScheduleDetailDescription>
        <ScheduleDetailActions>
          <Button disabled={running} onClick={onRunNow} size="sm" variant="ghost">
            Run now
          </Button>
          <Button onClick={onEdit} size="sm" variant="ghost">
            Edit
          </Button>
          <Button onClick={onDelete} size="sm" variant="ghost">
            Delete
          </Button>
        </ScheduleDetailActions>
        <ScheduleDetailHistory>
          <h3 className="text-sm font-medium">Recent runs</h3>
          <ScheduleRunHistory nowMs={nowMs} onOpenSession={onOpenSession} schedule={schedule} />
        </ScheduleDetailHistory>
      </SchedulePanelBody>
    </SchedulePanel>
  );
}
