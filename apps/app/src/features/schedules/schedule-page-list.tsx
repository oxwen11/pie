import type { Project, Schedule } from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@getpie/ui/components/input-group";
import { useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Plus, SearchIcon } from "lucide-react";

import { formatSpec } from "./cadence";
import { projectNameOf } from "./format";
import { ScheduleCard } from "./schedule-card";
import { useSchedule } from "./schedule-context";

export type ScheduleListFilter = "all" | "active" | "paused";

const FILTERS: ReadonlyArray<{ readonly value: ScheduleListFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];

export function SchedulePageList({
  filter,
  onFilter,
  onQuery,
  query,
}: {
  readonly filter: ScheduleListFilter;
  readonly onFilter: (filter: ScheduleListFilter) => void;
  readonly onQuery: (query: string) => void;
  readonly query: string;
}) {
  const { actions, meta } = useSchedule();
  const { setOpenMobile } = useSidebar();
  const visible = visibleSchedules(meta.items, meta.projects, query, filter);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-3">
      <div className="flex h-10 shrink-0 items-center px-1">
        <h1 className="text-sm font-semibold">Scheduled</h1>
      </div>
      <Button
        className="mb-2 h-11 shrink-0 justify-start"
        disabled={!meta.canCreate}
        onClick={() => {
          actions.openCreate();
          setOpenMobile(false);
        }}
        title={scheduleCreateTitle(meta.projects.length === 0, meta.atLimit)}
        variant="ghost"
      >
        <Plus />
        New task
      </Button>
      <div className="w-full pb-3">
        <InputGroup className="w-full">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search schedules"
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search schedules"
            value={query}
          />
        </InputGroup>
      </div>
      <ScheduleFilterBar filter={filter} onFilter={onFilter} />
      {meta.listPending || !meta.projectsReady ? (
        <p className="text-muted-foreground py-6 text-sm" role="status">
          Loading schedules…
        </p>
      ) : meta.listError !== null ? (
        <p className="text-muted-foreground py-6 text-sm">{meta.listError.message}</p>
      ) : (
        <SchedulePageItems
          empty={scheduleEmptyLabel(meta.items.length, query)}
          items={visible}
          projects={meta.projects}
        />
      )}
    </div>
  );
}

function ScheduleFilterBar({
  filter,
  onFilter,
}: {
  readonly filter: ScheduleListFilter;
  readonly onFilter: (filter: ScheduleListFilter) => void;
}) {
  return (
    <div className="flex h-11 w-full shrink-0 items-center gap-0.5 text-sm font-medium">
      {FILTERS.map((item) => (
        <button
          aria-pressed={filter === item.value}
          className={cn(
            "rounded-full px-2.5 py-1",
            filter === item.value
              ? "bg-foreground/8"
              : "text-muted-foreground hover:text-foreground",
          )}
          key={item.value}
          onClick={() => onFilter(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function scheduleCreateTitle(noProjects: boolean, atLimit: boolean): string | undefined {
  if (noProjects) return "Import a project first";
  if (atLimit) return `You can have at most ${MAX_SCHEDULES} schedules`;
  return undefined;
}

function scheduleEmptyLabel(count: number, query: string): string {
  if (count === 0) return "No schedules yet";
  if (query.trim().length > 0) return "No matching schedules.";
  return "No schedules in this view.";
}

function visibleSchedules(
  items: ReadonlyArray<Schedule>,
  projects: ReadonlyArray<Pick<Project, "id" | "name">>,
  query: string,
  filter: ScheduleListFilter,
): ReadonlyArray<Schedule> {
  const needle = query.trim().toLowerCase();
  return items.filter((schedule) => {
    if (filter === "active" && !schedule.enabled) return false;
    if (filter === "paused" && schedule.enabled) return false;
    if (needle === "") return true;
    const haystack =
      `${schedule.name} ${projectNameOf(projects, schedule.projectId)} ${formatSpec(schedule.spec)}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function SchedulePageItems({
  items,
  projects,
  empty,
}: {
  readonly items: ReadonlyArray<Schedule>;
  readonly projects: ReadonlyArray<Pick<Project, "id" | "name">>;
  readonly empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground py-6 text-sm">{empty}</p>;
  }
  return (
    <ul className="flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-y-auto pb-6">
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
