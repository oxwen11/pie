import type { Project, Schedule } from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { formatSessionReuse } from "./cadence";
import type { ScheduleFormSubmit } from "./schedule-form";

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
  if (value === null) {
    throw new Error("useSchedule must be used within ScheduleProvider");
  }
  return value;
}

export type ScheduleProviderProps = {
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
  readonly createOpen: boolean;
  readonly createDefaults?: ScheduleCreateDefaults;
  readonly onOpenCreate: () => void;
  readonly onCloseCreate: () => void;
  readonly children: ReactNode;
};

function openScheduleSession(
  navigate: ReturnType<typeof useNavigate>,
  projectId: string,
  sessionId: string,
) {
  navigate({
    to: "/session/$sessionId",
    params: { sessionId },
    search: { projectId },
  }).catch((error: unknown) => {
    console.error("Failed to open the schedule session", error);
  });
}

export function ScheduleProvider({
  projects,
  projectsReady,
  createOpen,
  createDefaults,
  onOpenCreate,
  onCloseCreate,
  children,
}: ScheduleProviderProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const schedules = useQuery({
    ...orpcQueryUtils.schedule.list.queryOptions(),
    refetchInterval: (query) => {
      const items = query.state.data;
      if (items === undefined) return false;
      return items.some((item) => item.lastRunStatus === "running") ? 2_000 : 10_000;
    },
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.agent.session.list.key() }),
    ]);

  const create = useMutation({
    mutationFn: (value: ScheduleFormSubmit) =>
      orpcQueryUtils.schedule.create.call({
        name: value.name,
        projectId: value.projectId,
        prompt: value.prompt,
        spec: value.spec,
        session: value.session,
        ...(value.expiresAt !== null ? { expiresAt: value.expiresAt } : undefined),
        ...(value.maxRuns !== null ? { maxRuns: value.maxRuns } : undefined),
        ...(value.runNow ? { runNow: true } : undefined),
        ...(value.worktree ? { worktree: {} } : undefined),
      }),
    onSuccess: (created) => {
      onCloseCreate();
      void invalidate();
      if (created.lastSessionId !== undefined) {
        openScheduleSession(navigate, created.projectId, created.lastSessionId);
        return;
      }
      if (created.lastRunStatus === "skipped") {
        toast.error("Schedule did not start a session (skipped).");
        return;
      }
      if (created.lastRunStatus === "failed") {
        toast.error(created.lastError ?? "Schedule failed to start a session.");
      }
    },
    onError: (error) => toast.error(`Failed to create schedule: ${error.message}`),
  });

  const update = useMutation({
    mutationFn: (
      input: { readonly id: string } & Partial<ScheduleFormSubmit> & {
          readonly enabled?: boolean;
        },
    ) =>
      orpcQueryUtils.schedule.update.call({
        id: input.id,
        ...(input.name !== undefined ? { name: input.name } : undefined),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : undefined),
        ...(input.spec !== undefined ? { spec: input.spec } : undefined),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : undefined),
        ...(input.session !== undefined ? { session: input.session } : undefined),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
        ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
        ...(input.worktree === true ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditingId(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to update schedule: ${error.message}`),
  });

  const remove = useMutation({
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
    mutationFn: (id: string) => orpcQueryUtils.schedule.runNow.call({ id }),
    onSuccess: (result) => {
      void invalidate();
      if (result.ref !== undefined) {
        openScheduleSession(navigate, result.ref.projectId, result.ref.sessionId);
        return;
      }
      if (result.schedule.lastRunStatus === "skipped") {
        toast.error("Schedule did not start a session (skipped).");
        return;
      }
      if (result.schedule.lastRunStatus === "failed") {
        toast.error(result.schedule.lastError ?? "Schedule failed to start a session.");
      }
    },
    onError: (error) => toast.error(`Failed to run schedule: ${error.message}`),
  });

  const items = schedules.data ?? EMPTY_SCHEDULES;
  const selected = selectedId === null ? undefined : items.find((item) => item.id === selectedId);
  const editing = editingId === null ? undefined : items.find((item) => item.id === editingId);
  const deleting = deletingId === null ? undefined : items.find((item) => item.id === deletingId);
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input:
        selected === undefined ? skipToken : { projectId: selected.projectId, archived: false },
    }),
  });
  const sessionTitleById = new Map<string, string>();
  for (const session of sessions.data ?? []) {
    sessionTitleById.set(session.sessionId, session.title ?? "New chat");
  }
  const atLimit = items.length >= MAX_SCHEDULES;
  const sessionLine =
    selected === undefined ? null : formatSessionReuse(selected.session, sessionTitleById);
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
        openSession: (projectId, sessionId) => openScheduleSession(navigate, projectId, sessionId),
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
      navigate,
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
