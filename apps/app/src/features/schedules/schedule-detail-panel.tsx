import { firedRunCount } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";

import {
  formatFiredCap,
  formatLastRun,
  formatNextRun,
  formatRunSummary,
  formatSpec,
  summarizeRuns,
} from "./cadence";
import { useSchedule } from "./schedule-context";
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

export function ScheduleDetailPanel() {
  const { actions, meta } = useSchedule();
  const schedule = meta.selected;
  if (schedule === undefined) return null;
  const lastRun = formatLastRun(schedule);
  const summary = formatRunSummary(summarizeRuns(schedule.runs));
  const projectName =
    meta.projects.find((item) => item.id === schedule.projectId)?.name ?? "Unknown project";
  return (
    <SchedulePanel aria-label={schedule.name}>
      <SchedulePanelHeader>
        <SchedulePanelTitle>{schedule.name}</SchedulePanelTitle>
        <SchedulePanelClose onClick={actions.closePanel} />
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
          {meta.sessionLine !== null ? (
            <ScheduleDetailLine>{meta.sessionLine}</ScheduleDetailLine>
          ) : null}
          {schedule.maxRuns !== undefined ? (
            <ScheduleDetailLine>
              {formatFiredCap(firedRunCount(schedule), schedule.maxRuns)}
            </ScheduleDetailLine>
          ) : null}
          {lastRun !== null ? <ScheduleDetailLine>{lastRun}</ScheduleDetailLine> : null}
          {summary !== null ? <ScheduleDetailLine>{summary}</ScheduleDetailLine> : null}
        </ScheduleDetailDescription>
        <ScheduleDetailActions>
          <Button
            disabled={meta.running}
            onClick={() => actions.runNow(schedule.id)}
            size="sm"
            variant="ghost"
          >
            Run now
          </Button>
          <Button onClick={() => actions.edit(schedule.id)} size="sm" variant="ghost">
            Edit
          </Button>
          <Button onClick={() => actions.askDelete(schedule.id)} size="sm" variant="ghost">
            Delete
          </Button>
        </ScheduleDetailActions>
        <ScheduleDetailHistory>
          <h3 className="text-sm font-medium">Recent runs</h3>
          <ScheduleRunHistory
            nowMs={Date.now()}
            onOpenSession={(sessionId) => actions.openSession(schedule.projectId, sessionId)}
            schedule={schedule}
          />
        </ScheduleDetailHistory>
      </SchedulePanelBody>
    </SchedulePanel>
  );
}
