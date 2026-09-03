import { MAX_SCHEDULES } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { Clock } from "lucide-react";
import { Group, Separator } from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";
import Loader from "@/components/loader";

import { ScheduleCard } from "./schedule-card";
import {
  ScheduleProvider,
  useSchedule,
  type ScheduleCreateDefaults,
  type ScheduleProviderProps,
} from "./schedule-context";
import { ScheduleDeleteDialog } from "./schedule-delete-dialog";
import { ScheduleDetailPanel } from "./schedule-detail-panel";
import { ScheduleEditorPanel } from "./schedule-editor-panel";

export type { ScheduleCreateDefaults };

export type SchedulePageProps = Omit<ScheduleProviderProps, "children">;

export function SchedulePage(props: SchedulePageProps) {
  return (
    <ScheduleProvider {...props}>
      <ScheduleWorkspace />
    </ScheduleProvider>
  );
}

function ScheduleWorkspace() {
  const { actions, meta } = useSchedule();

  if (!meta.projectsReady || meta.listPending) {
    return <Loader />;
  }

  if (meta.listError !== null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load schedules</EmptyTitle>
          <EmptyDescription>{meta.listError.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const list = (
    <>
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <p className="text-muted-foreground text-sm">
          Create a session on a cadence. These live on the server, not inside a chat.
        </p>
        <Button
          disabled={!meta.canCreate}
          onClick={actions.openCreate}
          title={
            meta.projects.length === 0
              ? "Import a project first"
              : meta.atLimit
                ? `You can have at most ${MAX_SCHEDULES} schedules`
                : undefined
          }
        >
          New schedule
        </Button>
      </div>

      {meta.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No schedules yet</EmptyTitle>
            <EmptyDescription>
              {meta.projects.length === 0
                ? "Import a project from the sidebar, then create a schedule to start a session later."
                : "A schedule creates a new session in a project and sends the prompt when it is due."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
          {meta.items.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              projectName={
                meta.projects.find((item) => item.id === schedule.projectId)?.name ??
                "Unknown project"
              }
              schedule={schedule}
            />
          ))}
        </ul>
      )}
    </>
  );

  const sidePanel =
    meta.createOpen || meta.editing !== undefined ? (
      <ScheduleEditorPanel />
    ) : meta.selected === undefined ? null : (
      <ScheduleDetailPanel />
    );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {sidePanel === null ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{list}</div>
      ) : (
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
      )}

      {meta.deleting !== undefined ? (
        <ScheduleDeleteDialog
          name={meta.deleting.name}
          onCancel={actions.cancelDelete}
          onConfirm={actions.confirmDelete}
          pending={meta.removing}
        />
      ) : null}
    </div>
  );
}
