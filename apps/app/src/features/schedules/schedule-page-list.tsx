import type { Project, Schedule } from "@getpie/contract";
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

import { projectNameOf } from "./format";
import { ScheduleCard } from "./schedule-card";
import { useSchedule } from "./schedule-context";

export function SchedulePageList() {
  const { actions, meta } = useSchedule();
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <p className="text-muted-foreground text-sm">
          Create a session on a cadence. These live on the server, not inside a chat.
        </p>
        <Button
          disabled={!meta.canCreate}
          onClick={() => actions.openCreate()}
          title={scheduleCreateTitle(meta.projects.length === 0, meta.atLimit)}
        >
          New schedule
        </Button>
      </div>
      <SchedulePageItems items={meta.items} projects={meta.projects} />
    </>
  );
}

function scheduleCreateTitle(noProjects: boolean, atLimit: boolean): string | undefined {
  if (noProjects) return "Import a project first";
  if (atLimit) return `You can have at most ${MAX_SCHEDULES} schedules`;
  return undefined;
}

function SchedulePageItems({
  items,
  projects,
}: {
  readonly items: ReadonlyArray<Schedule>;
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
}) {
  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Clock aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No schedules yet</EmptyTitle>
          <EmptyDescription>
            {projects.length === 0
              ? "Import a project from the sidebar, then create a schedule to start a session later."
              : "A schedule creates a new session in a project and sends the prompt when it is due."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
      {items.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          projectName={projectNameOf(projects, schedule.projectId)}
          schedule={schedule}
        />
      ))}
    </ul>
  );
}
