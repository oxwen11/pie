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
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useState } from "react";
import { Group, Separator } from "react-resizable-panels";
import { toast } from "sonner";

import { ResizablePanel } from "@/components/layout/resizable-panel";
import Loader from "@/components/loader";

import { formatSessionReuse } from "./cadence";
import { ScheduleCard } from "./schedule-card";
import { ScheduleDeleteDialog } from "./schedule-delete-dialog";
import { ScheduleDetailPanel } from "./schedule-detail-panel";
import { ScheduleEditorPanel, type ScheduleEditorState } from "./schedule-editor-panel";
import type { ScheduleFormSubmit } from "./schedule-form";

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
        navigate({
          to: "/session/$sessionId",
          params: { sessionId: created.lastSessionId },
          search: { projectId: created.projectId },
        }).catch((error: unknown) => {
          console.error("Failed to open the schedule session", error);
        });
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
        navigate({
          to: "/session/$sessionId",
          params: { sessionId: result.ref.sessionId },
          search: { projectId: result.ref.projectId },
        }).catch((error: unknown) => {
          console.error("Failed to open the schedule session", error);
        });
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

  const items = schedules.data ?? [];
  const selected = selectedId === null ? undefined : items.find((item) => item.id === selectedId);
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
  const editor: ScheduleEditorState | null =
    editing !== null
      ? { mode: "edit", schedule: editing }
      : createOpen
        ? {
            mode: "create",
            projectId: createDefaults?.projectId,
            sessionId: createDefaults?.sessionId,
          }
        : null;
  const atLimit = items.length >= MAX_SCHEDULES;
  const canCreate = projectsReady && projects.length > 0 && !atLimit;

  if (!projectsReady || schedules.isPending) {
    return <Loader />;
  }

  if (schedules.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load schedules</EmptyTitle>
          <EmptyDescription>{schedules.error.message}</EmptyDescription>
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
          disabled={!canCreate}
          onClick={onOpenCreate}
          title={
            projects.length === 0
              ? "Import a project first"
              : atLimit
                ? `You can have at most ${MAX_SCHEDULES} schedules`
                : undefined
          }
        >
          New schedule
        </Button>
      </div>

      {items.length === 0 ? (
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
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
          {items.map((schedule) => (
            <ScheduleCard
              schedule={schedule}
              key={schedule.id}
              onSelect={() => {
                setEditing(null);
                setSelectedId(schedule.id);
                if (createOpen) onCloseCreate();
              }}
              onToggle={(enabled) => update.mutate({ id: schedule.id, enabled })}
              projectName={
                projects.find((item) => item.id === schedule.projectId)?.name ?? "Unknown project"
              }
              selected={schedule.id === selectedId}
              updating={update.isPending}
            />
          ))}
        </ul>
      )}
    </>
  );

  const sidePanel =
    editor !== null ? (
      <ScheduleEditorPanel
        editor={editor}
        onClose={() => {
          if (editor.mode === "create") {
            onCloseCreate();
            return;
          }
          setEditing(null);
        }}
        onSubmit={(value) => {
          if (editor.mode === "create") {
            create.mutate(value);
            return;
          }
          update.mutate({ id: editor.schedule.id, ...value });
        }}
        projects={projects}
        submitting={create.isPending || update.isPending}
      />
    ) : selected === undefined ? null : (
      <ScheduleDetailPanel
        nowMs={Date.now()}
        onClose={() => setSelectedId(null)}
        onDelete={() => setDeleting(selected)}
        onEdit={() => setEditing(selected)}
        onOpenSession={(sessionId) => {
          const projectId = selected.projectId;
          navigate({
            to: "/session/$sessionId",
            params: { sessionId },
            search: { projectId },
          }).catch((error: unknown) => {
            console.error("Failed to open the schedule session", error);
          });
        }}
        onRunNow={() => runNow.mutate(selected.id)}
        projectName={
          projects.find((item) => item.id === selected.projectId)?.name ?? "Unknown project"
        }
        running={runNow.isPending}
        schedule={selected}
        sessionLine={formatSessionReuse(selected.session, sessionTitleById)}
      />
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

      {deleting !== null ? (
        <ScheduleDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
          pending={remove.isPending}
        />
      ) : null}
    </div>
  );
}
