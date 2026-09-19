import type { Schedule } from "@getpie/contract";
import type { ReactNode } from "react";
import { Group, Separator } from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";

import { useSchedule } from "./schedule-context";
import { ScheduleDeleteDialog } from "./schedule-delete-dialog";
import { ScheduleDetailPanel } from "./schedule-detail-panel";
import { ScheduleEditorPanel } from "./schedule-editor-panel";
import { SchedulePageList } from "./schedule-page-list";

export function SchedulePageFrame() {
  const { actions, meta } = useSchedule();
  const sidePanel =
    meta.createOpen || meta.editing !== undefined ? (
      <ScheduleEditorPanel />
    ) : meta.selected === undefined ? null : (
      <ScheduleDetailPanel />
    );
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <SchedulePageSplit list={<SchedulePageList />} sidePanel={sidePanel} />
      <SchedulePageDeleteDialog
        deleting={meta.deleting}
        onCancel={() => actions.cancelDelete()}
        onConfirm={() => actions.confirmDelete()}
        pending={meta.removing}
      />
    </div>
  );
}

function SchedulePageSplit({ list, sidePanel }: { list: ReactNode; sidePanel: ReactNode }) {
  if (sidePanel === null) {
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{list}</div>;
  }
  return (
    <Group
      className="flex min-h-0 flex-1"
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: 44, fine: 12 }}
    >
      <ResizablePanel className="flex min-w-0 flex-col" minSize="16rem">
        {list}
      </ResizablePanel>
      <Separator
        aria-label="Resize schedule panel"
        className="after:bg-border hover:after:bg-foreground/30 data-[separator=active]:after:bg-primary relative w-1.5 bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 data-[separator=active]:after:w-0.5"
      />
      <ResizablePanel
        className="flex min-w-0 flex-col"
        defaultSize="28rem"
        maxSize="50%"
        minSize="18rem"
      >
        {sidePanel}
      </ResizablePanel>
    </Group>
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
