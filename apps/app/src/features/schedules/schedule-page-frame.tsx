import type { Project, Schedule } from "@getpie/contract";
import type { ReactNode } from "react";
import { Group, Separator } from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";

import { formatSessionReuse } from "./cadence";
import { ScheduleDeleteDialog } from "./schedule-delete-dialog";
import { ScheduleDetailPanel } from "./schedule-detail-panel";
import { ScheduleEditorPanel, type ScheduleEditorState } from "./schedule-editor-panel";
import type { ScheduleFormSubmit } from "./schedule-form-model";
import { projectNameOf } from "./schedule-page-list";

export function SchedulePageFrame({
  list,
  sidePanel,
  deleting,
  onCancelDelete,
  onConfirmDelete,
  deletePending,
}: {
  readonly list: ReactNode;
  readonly sidePanel: ReactNode;
  readonly deleting: Schedule | null;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (id: string) => void;
  readonly deletePending: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <SchedulePageSplit list={list} sidePanel={sidePanel} />
      <SchedulePageDeleteDialog
        deleting={deleting}
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
        pending={deletePending}
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
  deleting: Schedule | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
  pending: boolean;
}) {
  if (deleting === null) return null;
  return (
    <ScheduleDeleteDialog
      name={deleting.name}
      onCancel={onCancel}
      onConfirm={() => onConfirm(deleting.id)}
      pending={pending}
    />
  );
}

export function SchedulePageSide({
  editor,
  selected,
  projects,
  submitting,
  sessionTitleById,
  running,
  nowMs,
  onCloseEditor,
  onSubmit,
  onCloseSelected,
  onDelete,
  onEdit,
  onOpenSession,
  onRunNow,
}: {
  readonly editor: ScheduleEditorState | null;
  readonly selected: Schedule | undefined;
  readonly projects: ReadonlyArray<Project>;
  readonly submitting: boolean;
  readonly sessionTitleById: ReadonlyMap<string, string>;
  readonly running: boolean;
  readonly nowMs: number;
  readonly onCloseEditor: (mode: ScheduleEditorState["mode"]) => void;
  readonly onSubmit: (value: ScheduleFormSubmit, editor: ScheduleEditorState) => void;
  readonly onCloseSelected: () => void;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onRunNow: () => void;
}) {
  if (editor !== null) {
    return (
      <ScheduleEditorPanel
        editor={editor}
        onClose={() => onCloseEditor(editor.mode)}
        onSubmit={(value) => onSubmit(value, editor)}
        projects={projects}
        submitting={submitting}
      />
    );
  }
  if (selected === undefined) return null;
  return (
    <ScheduleDetailPanel
      nowMs={nowMs}
      onClose={onCloseSelected}
      onDelete={onDelete}
      onEdit={onEdit}
      onOpenSession={onOpenSession}
      onRunNow={onRunNow}
      projectName={projectNameOf(projects, selected.projectId)}
      running={running}
      schedule={selected}
      sessionLine={formatSessionReuse(selected.session, sessionTitleById)}
    />
  );
}
