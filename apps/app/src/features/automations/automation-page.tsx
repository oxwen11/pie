import type { Project, Automation } from "@getpie/contract";
import { MAX_AUTOMATIONS } from "@getpie/contract";
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

import { AutomationForm, type AutomationFormSubmit } from "./automation-form";
import { formatNextRun, formatRunStatus, formatSkipReason, formatSpec } from "./cadence";

export type AutomationPageProps = {
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
};

type EditorState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly automation: Automation };

function lastRunLabel(automation: Automation): string | null {
  if (automation.lastRunStatus === undefined || automation.lastRunAt === undefined) return null;
  const when = new Date(automation.lastRunAt).toLocaleString();
  if (automation.lastRunStatus === "running") return `Running since ${when}`;
  if (automation.lastRunStatus === "succeeded") return `Last run ${when}`;
  if (automation.lastRunStatus === "interrupted") return `Interrupted ${when}`;
  if (automation.lastRunStatus === "missed") {
    const missed = automation.runs[0]?.missedCount;
    return missed !== undefined && missed > 0
      ? `Missed ${missed} run${missed === 1 ? "" : "s"} ${when}`
      : `Missed ${when}`;
  }
  if (automation.lastRunStatus === "skipped") {
    const reason = automation.runs[0]?.skipReason;
    return reason === undefined
      ? `Skipped ${when}`
      : `Skipped (${formatSkipReason(reason)}) ${when}`;
  }
  return automation.lastError === undefined
    ? `Failed ${when}`
    : `Failed ${when}: ${automation.lastError}`;
}

export function AutomationPage({ projects, projectsReady }: AutomationPageProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);

  const automations = useQuery(orpcQueryUtils.automation.list.queryOptions());

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.automation.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpcQueryUtils.agent.session.list.key() }),
    ]);

  const create = useMutation({
    mutationFn: (value: AutomationFormSubmit) =>
      orpcQueryUtils.automation.create.call({
        name: value.name,
        projectId: value.projectId,
        prompt: value.prompt,
        spec: value.spec,
        outputMode: value.outputMode,
        ...(value.expiresAt !== null ? { expiresAt: value.expiresAt } : undefined),
        ...(value.worktree ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditor(null);
      return invalidate();
    },
    onError: (error) => toast.error(`Failed to create automation: ${error.message}`),
  });

  const update = useMutation({
    mutationFn: (
      input: { readonly id: string } & Partial<AutomationFormSubmit> & {
          readonly enabled?: boolean;
        },
    ) =>
      orpcQueryUtils.automation.update.call({
        id: input.id,
        ...(input.name !== undefined ? { name: input.name } : undefined),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : undefined),
        ...(input.spec !== undefined ? { spec: input.spec } : undefined),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : undefined),
        ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : undefined),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
        ...(input.worktree === true ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditor(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.automation.list.key() });
    },
    onError: (error) => toast.error(`Failed to update automation: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.automation.delete.call({ id }),
    onSuccess: () => {
      setDeleting(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.automation.list.key() });
    },
    onError: (error) => toast.error(`Failed to delete automation: ${error.message}`),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.automation.runNow.call({ id }),
    onSuccess: (result) => {
      void invalidate();
      if (result.ref !== undefined) {
        navigate({
          to: "/session/$sessionId",
          params: { sessionId: result.ref.sessionId },
          search: { projectId: result.ref.projectId },
        }).catch((error: unknown) => {
          console.error("Failed to open the automation session", error);
        });
        return;
      }
      if (result.automation.lastRunStatus === "skipped") {
        toast.error("Automation did not start a session (skipped).");
        return;
      }
      if (result.automation.lastRunStatus === "failed") {
        toast.error(result.automation.lastError ?? "Automation failed to start a session.");
      }
    },
    onError: (error) => toast.error(`Failed to run automation: ${error.message}`),
  });

  const items = automations.data ?? [];
  const atLimit = items.length >= MAX_AUTOMATIONS;
  const canCreate = projectsReady && projects.length > 0 && !atLimit;

  if (!projectsReady || automations.isPending) {
    return <Loader />;
  }

  if (automations.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load automations</EmptyTitle>
          <EmptyDescription>{automations.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <p className="text-muted-foreground text-sm">
          Create a session on a cadence. These live on the server, not inside a chat.
        </p>
        <Button
          disabled={!canCreate}
          onClick={() => setEditor({ mode: "create" })}
          title={
            projects.length === 0
              ? "Import a project first"
              : atLimit
                ? `You can have at most ${MAX_AUTOMATIONS} automations`
                : undefined
          }
        >
          New automation
        </Button>
      </div>

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No automations yet</EmptyTitle>
            <EmptyDescription>
              {projects.length === 0
                ? "Import a project from the sidebar, then create an automation to start a session later."
                : "An automation creates a new session in a project and sends the prompt when it is due."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
          {items.map((automation) => {
            const project = projects.find((item) => item.id === automation.projectId);
            const lastRun = lastRunLabel(automation);
            return (
              <li
                className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
                key={automation.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{automation.name}</div>
                    <div className="text-muted-foreground truncate text-sm">
                      {project?.name ?? "Unknown project"} · {formatSpec(automation.spec)}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {formatNextRun(
                        automation.nextRunAt,
                        automation.enabled,
                        automation.pauseReason,
                      )}
                    </div>
                    {lastRun !== null ? (
                      <div className="text-muted-foreground text-sm">{lastRun}</div>
                    ) : null}
                    {automation.runs.length > 0 ? (
                      <ol className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs">
                        {automation.runs.slice(0, 3).map((run) => (
                          <li key={run.id}>
                            {formatRunStatus(run.status)}
                            {run.skipReason !== undefined
                              ? ` (${formatSkipReason(run.skipReason)})`
                              : ""}
                            {` · ${new Date(run.startedAt).toLocaleString()}`}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                  <Switch
                    aria-label={automation.enabled ? "Pause automation" : "Enable automation"}
                    checked={automation.enabled}
                    disabled={update.isPending}
                    onCheckedChange={(enabled) => update.mutate({ id: automation.id, enabled })}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate(automation.id)}
                    size="sm"
                    variant="ghost"
                  >
                    Run now
                  </Button>
                  <Button
                    onClick={() => setEditor({ mode: "edit", automation })}
                    size="sm"
                    variant="ghost"
                  >
                    Edit
                  </Button>
                  <Button onClick={() => setDeleting(automation)} size="sm" variant="ghost">
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
                {editor.mode === "create" ? "New automation" : "Edit automation"}
              </DialogTitle>
              <DialogDescription>
                When this is due, pie starts a session in the project and sends the prompt.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <AutomationForm
                initial={editor.mode === "edit" ? editor.automation : undefined}
                onCancel={() => setEditor(null)}
                onSubmit={(value) => {
                  if (editor.mode === "create") {
                    create.mutate(value);
                    return;
                  }
                  update.mutate({ id: editor.automation.id, ...value });
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
              <DialogTitle>Delete automation</DialogTitle>
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
