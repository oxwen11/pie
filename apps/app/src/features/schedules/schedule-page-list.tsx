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

export function SchedulePageList({
  items,
  projects,
  canCreate,
  atLimit,
  selectedId,
  updating,
  onOpenCreate,
  onSelect,
  onToggle,
}: {
  readonly items: ReadonlyArray<Schedule>;
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly canCreate: boolean;
  readonly atLimit: boolean;
  readonly selectedId: string | null;
  readonly updating: boolean;
  readonly onOpenCreate: () => void;
  readonly onSelect: (scheduleId: string) => void;
  readonly onToggle: (scheduleId: string, enabled: boolean) => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <p className="text-muted-foreground text-sm">
          Create a session on a cadence. These live on the server, not inside a chat.
        </p>
        <Button
          disabled={!canCreate}
          onClick={onOpenCreate}
          title={scheduleCreateTitle(projects.length === 0, atLimit)}
        >
          New schedule
        </Button>
      </div>
      <SchedulePageItems
        items={items}
        onSelect={onSelect}
        onToggle={onToggle}
        projects={projects}
        selectedId={selectedId}
        updating={updating}
      />
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
  selectedId,
  updating,
  onSelect,
  onToggle,
}: {
  readonly items: ReadonlyArray<Schedule>;
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly selectedId: string | null;
  readonly updating: boolean;
  readonly onSelect: (scheduleId: string) => void;
  readonly onToggle: (scheduleId: string, enabled: boolean) => void;
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
          onSelect={() => onSelect(schedule.id)}
          onToggle={(enabled) => onToggle(schedule.id, enabled)}
          projectName={projectNameOf(projects, schedule.projectId)}
          schedule={schedule}
          selected={schedule.id === selectedId}
          updating={updating}
        />
      ))}
    </ul>
  );
}
