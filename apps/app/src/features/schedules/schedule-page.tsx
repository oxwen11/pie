import type { Project, Schedule } from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";

import type { ScheduleEditorState } from "./schedule-editor-panel";
import {
  scheduleCreateInput,
  scheduleUpdateInput,
  type ScheduleFormSubmit,
} from "./schedule-form-model";
import { SchedulePageFrame, SchedulePageSide } from "./schedule-page-frame";
import { SchedulePageList } from "./schedule-page-list";

export type ScheduleCreateDefaults = {
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type SchedulePageProps = {
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
  readonly createOpen: boolean;
  readonly createDefaults?: ScheduleCreateDefaults;
  readonly onOpenCreate: () => void;
  readonly onCloseCreate: () => void;
};

export function SchedulePage({
  projects,
  projectsReady,
  createOpen,
  createDefaults,
  onOpenCreate,
  onCloseCreate,
}: SchedulePageProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const schedules = useQuery({
    ...orpcQueryUtils.schedule.list.queryOptions(),
    refetchInterval: (query) => scheduleListInterval(query.state.data),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.agent.session.list.key() }),
    ]);

  const create = useMutation({
    mutationFn: (value: ScheduleFormSubmit) =>
      orpcQueryUtils.schedule.create.call(scheduleCreateInput(value)),
    onSuccess: (created) => {
      onCloseCreate();
      void invalidate();
      if (created.lastSessionId !== undefined) {
        openScheduleSession(navigate, created.lastSessionId, created.projectId);
        return;
      }
      reportScheduleStart(created);
    },
    onError: (error) => toast.error(`Failed to create schedule: ${error.message}`),
  });

  const update = useMutation({
    mutationFn: (
      input: { readonly id: string } & Partial<ScheduleFormSubmit> & {
          readonly enabled?: boolean;
        },
    ) => orpcQueryUtils.schedule.update.call(scheduleUpdateInput(input)),
    onSuccess: () => {
      setEditing(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to update schedule: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.schedule.delete.call({ id }),
    onSuccess: () => {
      setDeleting(null);
      setSelectedId(null);
      setEditing(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to delete schedule: ${error.message}`),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.schedule.runNow.call({ id }),
    onSuccess: (result) => {
      void invalidate();
      if (result.ref !== undefined) {
        openScheduleSession(navigate, result.ref.sessionId, result.ref.projectId);
        return;
      }
      reportScheduleStart(result.schedule);
    },
    onError: (error) => toast.error(`Failed to run schedule: ${error.message}`),
  });

  const items = scheduleItems(schedules.data);
  const selected = selectedSchedule(items, selectedId);
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: selectedSessionListInput(selected),
    }),
  });
  const editor = scheduleEditorState(editing, createOpen, createDefaults);
  const placeholder = schedulePagePlaceholder({
    projectsReady,
    schedulesPending: schedules.isPending,
    schedulesError: schedules.isError,
    errorMessage: schedules.error?.message,
  });
  if (placeholder !== null) return placeholder;

  return (
    <SchedulePageFrame
      deletePending={remove.isPending}
      deleting={deleting}
      list={
        <SchedulePageList
          atLimit={items.length >= MAX_SCHEDULES}
          canCreate={canCreateSchedule(projectsReady, projects.length, items.length)}
          items={items}
          onOpenCreate={onOpenCreate}
          onSelect={(scheduleId) => {
            setEditing(null);
            setSelectedId(scheduleId);
            if (createOpen) onCloseCreate();
          }}
          onToggle={(id, enabled) => update.mutate({ id, enabled })}
          projects={projects}
          selectedId={selectedId}
          updating={update.isPending}
        />
      }
      onCancelDelete={() => setDeleting(null)}
      onConfirmDelete={(id) => remove.mutate(id)}
      sidePanel={schedulePageSide({
        editor,
        nowMs: Date.now(),
        onCloseEditor: (mode) => {
          if (mode === "create") {
            onCloseCreate();
            return;
          }
          setEditing(null);
        },
        onCloseSelected: () => setSelectedId(null),
        onDelete: () => {
          if (selected !== undefined) setDeleting(selected);
        },
        onEdit: () => {
          if (selected !== undefined) setEditing(selected);
        },
        onOpenSession: (sessionId) => {
          if (selected === undefined) return;
          openScheduleSession(navigate, sessionId, selected.projectId);
        },
        onRunNow: () => {
          if (selected !== undefined) runNow.mutate(selected.id);
        },
        onSubmit: (value, current) => {
          if (current.mode === "create") {
            create.mutate(value);
            return;
          }
          update.mutate({ id: current.schedule.id, ...value });
        },
        projects,
        running: runNow.isPending,
        selected,
        sessionTitleById: sessionTitleMap(sessions.data),
        submitting: eitherPending(create.isPending, update.isPending),
      })}
    />
  );
}

function schedulePageSide(props: Parameters<typeof SchedulePageSide>[0]): ReactNode {
  if (props.editor === null && props.selected === undefined) return null;
  return <SchedulePageSide {...props} />;
}

function scheduleItems(data: ReadonlyArray<Schedule> | undefined): ReadonlyArray<Schedule> {
  return data ?? [];
}

function selectedSchedule(
  items: ReadonlyArray<Schedule>,
  selectedId: string | null,
): Schedule | undefined {
  if (selectedId === null) return undefined;
  return items.find((item) => item.id === selectedId);
}

function selectedSessionListInput(selected: Schedule | undefined) {
  if (selected === undefined) return skipToken;
  return { projectId: selected.projectId, archived: false };
}

function canCreateSchedule(
  projectsReady: boolean,
  projectCount: number,
  itemCount: number,
): boolean {
  return projectsReady && projectCount > 0 && itemCount < MAX_SCHEDULES;
}

function eitherPending(left: boolean, right: boolean): boolean {
  return left || right;
}

function scheduleListInterval(items: ReadonlyArray<Schedule> | undefined): number | false {
  if (items === undefined) return false;
  return items.some((item) => item.lastRunStatus === "running") ? 2_000 : 10_000;
}

function scheduleEditorState(
  editing: Schedule | null,
  createOpen: boolean,
  createDefaults?: ScheduleCreateDefaults,
): ScheduleEditorState | null {
  if (editing !== null) return { mode: "edit", schedule: editing };
  if (!createOpen) return null;
  return {
    mode: "create",
    projectId: createDefaults?.projectId,
    sessionId: createDefaults?.sessionId,
  };
}

function sessionTitleMap(
  sessions:
    | ReadonlyArray<{ readonly sessionId: string; readonly title?: string | null }>
    | undefined,
): Map<string, string> {
  return new Map(
    (sessions ?? []).map((session) => [session.sessionId, session.title ?? "New chat"]),
  );
}

function schedulePagePlaceholder({
  projectsReady,
  schedulesPending,
  schedulesError,
  errorMessage,
}: {
  projectsReady: boolean;
  schedulesPending: boolean;
  schedulesError: boolean;
  errorMessage: string | undefined;
}): ReactNode {
  if (!projectsReady || schedulesPending) return <Loader />;
  if (!schedulesError) return null;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Could not load schedules</EmptyTitle>
        <EmptyDescription>{errorMessage}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function openScheduleSession(
  navigate: ReturnType<typeof useNavigate>,
  sessionId: string,
  projectId: string,
): void {
  navigate({
    to: "/session/$sessionId",
    params: { sessionId },
    search: { projectId },
  }).catch((error: unknown) => {
    console.error("Failed to open the schedule session", error);
  });
}

function reportScheduleStart(schedule: {
  readonly lastRunStatus?: string;
  readonly lastError?: string | null;
}): void {
  if (schedule.lastRunStatus === "skipped") {
    toast.error("Schedule did not start a session (skipped).");
    return;
  }
  if (schedule.lastRunStatus === "failed") {
    toast.error(schedule.lastError ?? "Schedule failed to start a session.");
  }
}
