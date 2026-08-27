import type { Project, Schedule } from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { Switch } from "@getpie/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";

import { formatNextRun, formatSpec } from "./cadence";
import { ScheduleForm, type ScheduleFormSubmit } from "./schedule-form";

export type SchedulePageProps = {
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
};

type EditorState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly schedule: Schedule };

function lastRunLabel(schedule: Schedule): string | null {
  if (schedule.lastRunStatus === undefined || schedule.lastRunAt === undefined) return null;
  const when = new Date(schedule.lastRunAt).toLocaleString();
  if (schedule.lastRunStatus === "started") return `Last run ${when}`;
  if (schedule.lastRunStatus === "skipped") {
    const reason = schedule.runs[0]?.skipReason;
    return reason === undefined ? `Skipped ${when}` : `Skipped (${reason}) ${when}`;
  }
  return schedule.lastError === undefined
    ? `Failed ${when}`
    : `Failed ${when}: ${schedule.lastError}`;
}

export function SchedulePage({ projects, projectsReady }: SchedulePageProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  const schedules = useQuery(orpcQueryUtils.schedule.list.queryOptions());

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
        ...(value.worktree ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditor(null);
      return invalidate();
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
        ...(input.worktree === true ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditor(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.schedule.list.key() });
    },
    onError: (error) => toast.error(`Failed to update schedule: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.schedule.delete.call({ id }),
    onSuccess: () => {
      setDeleting(null);
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
          console.error("Failed to open the scheduled session", error);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <p className="text-muted-foreground text-sm">
          Create a new session on a cadence. These live on the server, not inside a chat.
        </p>
        <Button
          disabled={!canCreate}
          onClick={() => setEditor({ mode: "create" })}
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
          {items.map((schedule) => {
            const project = projects.find((item) => item.id === schedule.projectId);
            const lastRun = lastRunLabel(schedule);
            return (
              <li
                className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
                key={schedule.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{schedule.name}</div>
                    <div className="text-muted-foreground truncate text-sm">
                      {project?.name ?? "Unknown project"} · {formatSpec(schedule.spec)}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {formatNextRun(schedule.nextRunAt, schedule.enabled)}
                    </div>
                    {lastRun !== null ? (
                      <div className="text-muted-foreground text-sm">{lastRun}</div>
                    ) : null}
                  </div>
                  <Switch
                    aria-label={schedule.enabled ? "Pause schedule" : "Enable schedule"}
                    checked={schedule.enabled}
                    disabled={update.isPending}
                    onCheckedChange={(enabled) => update.mutate({ id: schedule.id, enabled })}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate(schedule.id)}
                    size="sm"
                    variant="ghost"
                  >
                    Run now
                  </Button>
                  <Button
                    onClick={() => setEditor({ mode: "edit", schedule })}
                    size="sm"
                    variant="ghost"
                  >
                    Edit
                  </Button>
                  <Button onClick={() => setDeleting(schedule)} size="sm" variant="ghost">
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editor !== null ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open && !create.isPending && !update.isPending) setEditor(null);
          }}
          open
        >
          <DialogPopup className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editor.mode === "create" ? "New schedule" : "Edit schedule"}
              </DialogTitle>
              <DialogDescription>
                When this is due, pie creates a new session in the project and sends the prompt.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <ScheduleForm
                initial={editor.mode === "edit" ? editor.schedule : undefined}
                onCancel={() => setEditor(null)}
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
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}

      {deleting !== null ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(null);
          }}
          open
        >
          <DialogPopup className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete schedule</DialogTitle>
              <DialogDescription>
                {deleting.name} will stop creating sessions. Sessions it already created stay in the
                sidebar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={remove.isPending}
                onClick={() => setDeleting(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
                variant="destructive"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
