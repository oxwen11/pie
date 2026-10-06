import type { Schedule } from "@getpie/contract";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";

import { useSchedule } from "./schedule-context";
import { ScheduleDeleteDialog } from "./schedule-delete-dialog";
import { ScheduleDetailPanel } from "./schedule-detail-panel";
import { ScheduleEditorPanel } from "./schedule-editor-panel";

export function SchedulePageFrame() {
  const { actions, meta } = useSchedule();
  const sidePanel =
    meta.createOpen || meta.editing !== undefined ? (
      <ScheduleEditorPanel />
    ) : meta.selected === undefined ? null : (
      <ScheduleDetailPanel />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {sidePanel ?? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Schedule a task</EmptyTitle>
            <EmptyDescription>Start a session in a project on a cadence.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <SchedulePageDeleteDialog
        deleting={meta.deleting}
        onCancel={() => actions.cancelDelete()}
        onConfirm={() => actions.confirmDelete()}
        pending={meta.removing}
      />
    </div>
  );
}

function SchedulePageDeleteDialog({
  deleting,
  onCancel,
  onConfirm,
  pending,
}: {
  deleting: Schedule | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (deleting === undefined) return null;
  return (
    <ScheduleDeleteDialog
      name={deleting.name}
      onCancel={onCancel}
      onConfirm={onConfirm}
      pending={pending}
    />
  );
}
