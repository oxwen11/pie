import type { Project, Schedule } from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useEnvironmentOrpc } from "@/lib/environment-orpc";

import { formatSessionReuse } from "./cadence";
import {
  scheduleCreateInput,
  scheduleUpdateInput,
  type ScheduleFormSubmit,
} from "./schedule-form-model";

export type ScheduleCreateDefaults = {
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type ScheduleState = {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  readonly deletingId: string | null;
};

export type ScheduleActions = {
  readonly select: (id: string) => void;
  readonly closePanel: () => void;
  readonly edit: (id: string) => void;
  readonly cancelEdit: () => void;
  readonly askDelete: (id: string) => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
  readonly toggle: (id: string, enabled: boolean) => void;
  readonly runNow: (id: string) => void;
  readonly create: (value: ScheduleFormSubmit) => void;
  readonly save: (id: string, value: ScheduleFormSubmit) => void;
  readonly openCreate: () => void;
  readonly closeCreate: () => void;
  readonly openSession: (projectId: string, sessionId: string) => void;
};

export type ScheduleMeta = {
  readonly items: ReadonlyArray<Schedule>;
  readonly selected: Schedule | undefined;
  readonly editing: Schedule | undefined;
  readonly deleting: Schedule | undefined;
  readonly projects: ReadonlyArray<Project>;
  readonly createOpen: boolean;
  readonly createDefaults?: ScheduleCreateDefaults;
  readonly sessionLine: string | null;
  readonly nowMs: number;
  readonly submitting: boolean;
  readonly running: boolean;
  readonly updating: boolean;
  readonly removing: boolean;
  readonly canCreate: boolean;
  readonly atLimit: boolean;
  readonly projectsReady: boolean;
  readonly listPending: boolean;
  readonly listError: Error | null;
};

export type ScheduleContextValue = {
  readonly state: ScheduleState;
  readonly actions: ScheduleActions;
  readonly meta: ScheduleMeta;
};

const EMPTY_SCHEDULES: ReadonlyArray<Schedule> = [];
const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function useSchedule(): ScheduleContextValue {
  const value = use(ScheduleContext);
  if (value === null) throw new Error("useSchedule must be used within ScheduleProvider");
  return value;
}

export type ScheduleProviderProps = {
  readonly environmentId: string;
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
  readonly createOpen: boolean;
  readonly createDefaults?: ScheduleCreateDefaults;
  readonly onOpenCreate: () => void;
  readonly onCloseCreate: () => void;
  readonly children: ReactNode;
};

export function ScheduleProvider({
  environmentId,
  projects,
  projectsReady,
  createOpen,
  createDefaults,
  onOpenCreate,
  onCloseCreate,
  children,
}: ScheduleProviderProps) {
  const orpcQueryUtils = useEnvironmentOrpc();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    mutationKey: orpcQueryUtils.schedule.create.key(),
    mutationFn: (value: ScheduleFormSubmit) =>
      orpcQueryUtils.schedule.create.call(scheduleCreateInput(value)),
    onSuccess: (created) => {
      onCloseCreate();
      void invalidate();
      if (created.lastSessionId !== undefined) {
        openScheduleSession(navigate, created.projectId, created.lastSessionId, environmentId);
        return;
      }
      reportScheduleStart(created);
    },
    onError: (error) => toast.error(`Failed to create schedule: ${error.message}`),
  });

  const update = useMutation({
    mutationKey: orpcQueryUtils.schedule.update.key(),
    mutationFn: (
      input: { readonly id: string } & Partial<ScheduleFormSubmit> & {
          readonly enabled?: boolean;
        },
    ) => orpcQueryUtils.schedule.update.call(scheduleUpdateInput(input)),
    onSuccess: () => {
      setEditingId(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to update schedule: ${error.message}`),
  });

  const remove = useMutation({
    mutationKey: orpcQueryUtils.schedule.delete.key(),
    mutationFn: (id: string) => orpcQueryUtils.schedule.delete.call({ id }),
    onSuccess: () => {
      setDeletingId(null);
      setSelectedId(null);
      setEditingId(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to delete schedule: ${error.message}`),
  });

  const runNow = useMutation({
    mutationKey: orpcQueryUtils.schedule.runNow.key(),
    mutationFn: (id: string) => orpcQueryUtils.schedule.runNow.call({ id }),
    onSuccess: (result) => {
      void invalidate();
      if (result.ref !== undefined) {
        openScheduleSession(navigate, result.ref.projectId, result.ref.sessionId, environmentId);
        return;
      }
      reportScheduleStart(result.schedule);
    },
    onError: (error) => toast.error(`Failed to run schedule: ${error.message}`),
  });

  const items = schedules.data ?? EMPTY_SCHEDULES;
  const selected = scheduleOf(items, selectedId);
  const editing = scheduleOf(items, editingId);
  const deleting = scheduleOf(items, deletingId);
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input:
        selected === undefined ? skipToken : { projectId: selected.projectId, archived: false },
    }),
  });
  const atLimit = items.length >= MAX_SCHEDULES;
  const sessionLine =
    selected === undefined
      ? null
      : formatSessionReuse(selected.session, sessionTitleMap(sessions.data));
  const nowMs = schedules.dataUpdatedAt;
  const createPending = create.isPending;
  const updatePending = update.isPending;
  const runNowPending = runNow.isPending;
  const removePending = remove.isPending;
  const listPending = schedules.isPending;
  const listError = schedules.isError ? schedules.error : null;
  const value = useMemo<ScheduleContextValue>(
    () => ({
      state: { selectedId, editingId, deletingId },
      actions: {
        select: (id) => {
          setEditingId(null);
          setSelectedId(id);
          if (createOpen) onCloseCreate();
        },
        closePanel: () => setSelectedId(null),
        edit: (id) => setEditingId(id),
        cancelEdit: () => setEditingId(null),
        askDelete: (id) => setDeletingId(id),
        cancelDelete: () => setDeletingId(null),
        confirmDelete: () => {
          if (deletingId !== null) remove.mutate(deletingId);
        },
        toggle: (id, enabled) => update.mutate({ id, enabled }),
        runNow: (id) => runNow.mutate(id),
        create: (form) => create.mutate(form),
        save: (id, form) => update.mutate({ id, ...form }),
        openCreate: onOpenCreate,
        closeCreate: onCloseCreate,
        openSession: (projectId, sessionId) =>
          openScheduleSession(navigate, projectId, sessionId, environmentId),
      },
      meta: {
        items,
        selected,
        editing,
        deleting,
        projects,
        createOpen,
        createDefaults,
        sessionLine,
        nowMs,
        submitting: createPending || updatePending,
        running: runNowPending,
        updating: updatePending,
        removing: removePending,
        canCreate: projectsReady && projects.length > 0 && !atLimit,
        atLimit,
        projectsReady,
        listPending,
        listError,
      },
    }),
    [
      atLimit,
      create,
      createDefaults,
      createOpen,
      createPending,
      deleting,
      deletingId,
      editing,
      editingId,
      items,
      listError,
      listPending,
      environmentId,
      navigate,
      nowMs,
      onCloseCreate,
      onOpenCreate,
      projects,
      projectsReady,
      remove,
      removePending,
      runNow,
      runNowPending,
      selected,
      selectedId,
      sessionLine,
      update,
      updatePending,
    ],
  );

  return <ScheduleContext value={value}>{children}</ScheduleContext>;
}

function scheduleOf(items: ReadonlyArray<Schedule>, id: string | null): Schedule | undefined {
  if (id === null) return undefined;
  return items.find((item) => item.id === id);
}

function scheduleListInterval(items: ReadonlyArray<Schedule> | undefined): number | false {
  if (items === undefined) return false;
  return items.some((item) => item.lastRunStatus === "running") ? 2_000 : 10_000;
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

function openScheduleSession(
  navigate: ReturnType<typeof useNavigate>,
  projectId: string,
  sessionId: string,
  environmentId: string,
): void {
  navigate({
    to: "/session/$sessionId",
    params: { sessionId },
    search: { projectId, environmentId },
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
