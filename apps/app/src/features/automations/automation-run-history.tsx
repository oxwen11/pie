import type { Automation, AutomationRun, AutomationRunStatus } from "@getpie/contract";
import { Badge } from "@getpie/ui/components/badge";
import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";

import { formatRunDuration, formatRunReason, formatRunStatus, formatSkipReason } from "./cadence";

export type AutomationRunHistoryProps = {
  readonly automation: Automation;
  readonly projectName: string;
  readonly nowMs: number;
  readonly onClose: () => void;
  readonly onOpenSession: (sessionId: string) => void;
};

function statusVariant(
  status: AutomationRunStatus,
): "info" | "success" | "error" | "secondary" | "warning" {
  if (status === "running") return "info";
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  if (status === "skipped") return "secondary";
  return "warning";
}

function runDetail(run: AutomationRun): string | null {
  if (run.error !== undefined) return run.error;
  if (run.skipReason !== undefined) return formatSkipReason(run.skipReason);
  if (run.missedCount !== undefined && run.missedCount > 0) {
    return `${run.missedCount} missed slot${run.missedCount === 1 ? "" : "s"}`;
  }
  return null;
}

export function AutomationRunHistory({
  automation,
  projectName,
  nowMs,
  onClose,
  onOpenSession,
}: AutomationRunHistoryProps) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{automation.name}</DialogTitle>
          <DialogDescription>
            Recent runs in {projectName}. The server keeps the last 20.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {automation.runs.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No runs yet</EmptyTitle>
                <EmptyDescription>
                  Run now, or wait until this schedule is due. Each fire is recorded here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="flex flex-col gap-3">
              {automation.runs.map((run) => {
                const duration = formatRunDuration(run.startedAt, run.finishedAt, nowMs);
                const detail = runDetail(run);
                const sessionId = run.sessionId;
                return (
                  <li className="flex flex-col gap-1" key={run.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(run.status)}>
                          {formatRunStatus(run.status)}
                        </Badge>
                        <span className="text-muted-foreground text-sm">
                          {formatRunReason(run.reason)}
                          {duration !== null ? ` · ${duration}` : ""}
                        </span>
                      </div>
                      {sessionId !== undefined ? (
                        <Button onClick={() => onOpenSession(sessionId)} size="sm" variant="ghost">
                          Open session
                        </Button>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(run.startedAt).toLocaleString()}
                    </div>
                    {detail !== null ? (
                      <div className="text-muted-foreground text-sm">{detail}</div>
                    ) : null}
                    {run.snapshot !== undefined ? (
                      <div
                        className="text-muted-foreground truncate text-xs"
                        title={run.snapshot.prompt}
                      >
                        {run.snapshot.prompt}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
