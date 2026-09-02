import type { Project, Automation } from "@getpie/contract";
import { MAX_AUTOMATIONS } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";

import { AutomationCard } from "./automation-card";
import { AutomationDeleteDialog } from "./automation-delete-dialog";
import { AutomationEditorDialog, type AutomationEditorState } from "./automation-editor-dialog";
import type { AutomationFormSubmit } from "./automation-form";
import { AutomationRunHistory } from "./automation-run-history";
import { formatSessionReuse } from "./cadence";

export type AutomationCreateDefaults = {
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type AutomationPageProps = {
  readonly projects: ReadonlyArray<Project>;
  readonly projectsReady: boolean;
  readonly createOpen: boolean;
  readonly createDefaults?: AutomationCreateDefaults;
  readonly onOpenCreate: () => void;
  readonly onCloseCreate: () => void;
};

export function AutomationPage({
  projects,
  projectsReady,
  createOpen,
  createDefaults,
  onOpenCreate,
  onCloseCreate,
}: AutomationPageProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [history, setHistory] = useState<Automation | null>(null);

  const automations = useQuery({
    ...orpcQueryUtils.automation.list.queryOptions(),
    refetchInterval: (query) => {
      const items = query.state.data;
      if (items === undefined) return false;
      return items.some((item) => item.lastRunStatus === "running") ? 2_000 : 10_000;
    },
  });

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
          console.error("Failed to open the automation session", error);
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
        ...(input.session !== undefined ? { session: input.session } : undefined),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
        ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
        ...(input.worktree === true ? { worktree: {} } : undefined),
      }),
    onSuccess: () => {
      setEditing(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.automation.list.key() });
    },
    onError: (error) => toast.error(`Failed to update schedule: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpcQueryUtils.automation.delete.call({ id }),
    onSuccess: () => {
      setDeleting(null);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.automation.list.key() });
    },
    onError: (error) => toast.error(`Failed to delete schedule: ${error.message}`),
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
        toast.error("Schedule did not start a session (skipped).");
        return;
      }
      if (result.automation.lastRunStatus === "failed") {
        toast.error(result.automation.lastError ?? "Schedule failed to start a session.");
      }
    },
    onError: (error) => toast.error(`Failed to run schedule: ${error.message}`),
  });

  const items = automations.data ?? [];
  const projectIds = [...new Set(items.map((item) => item.projectId))];
  const sessionLists = useQueries({
    queries: projectIds.map((projectId) =>
      orpcQueryUtils.agent.session.list.queryOptions({
        input: { projectId, archived: false },
      }),
    ),
  });
  const sessionTitleById = new Map<string, string>();
  for (const query of sessionLists) {
    for (const session of query.data ?? []) {
      sessionTitleById.set(session.sessionId, session.title ?? "New chat");
    }
  }
  const editor: AutomationEditorState | null =
    editing !== null
      ? { mode: "edit", automation: editing }
      : createOpen
        ? {
            mode: "create",
            projectId: createDefaults?.projectId,
            sessionId: createDefaults?.sessionId,
          }
        : null;
  const historyAutomation =
    history === null ? null : (items.find((item) => item.id === history.id) ?? history);
  const atLimit = items.length >= MAX_AUTOMATIONS;
  const canCreate = projectsReady && projects.length > 0 && !atLimit;

  if (!projectsReady || automations.isPending) {
    return <Loader />;
  }

  if (automations.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load schedules</EmptyTitle>
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
          onClick={onOpenCreate}
          title={
            projects.length === 0
              ? "Import a project first"
              : atLimit
                ? `You can have at most ${MAX_AUTOMATIONS} schedules`
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
          {items.map((automation) => (
            <AutomationCard
              automation={automation}
              key={automation.id}
              onDelete={() => setDeleting(automation)}
              onEdit={() => setEditing(automation)}
              onHistory={() => setHistory(automation)}
              onRunNow={() => runNow.mutate(automation.id)}
              onToggle={(enabled) => update.mutate({ id: automation.id, enabled })}
              projectName={
                projects.find((item) => item.id === automation.projectId)?.name ?? "Unknown project"
              }
              sessionLine={formatSessionReuse(automation.session, sessionTitleById)}
              running={runNow.isPending}
              updating={update.isPending}
            />
          ))}
        </ul>
      )}

      {editor !== null ? (
        <AutomationEditorDialog
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
            update.mutate({ id: editor.automation.id, ...value });
          }}
          projects={projects}
          submitting={create.isPending || update.isPending}
        />
      ) : null}

      {historyAutomation !== null ? (
        <AutomationRunHistory
          automation={historyAutomation}
          nowMs={Date.now()}
          onClose={() => setHistory(null)}
          onOpenSession={(sessionId) => {
            const projectId = historyAutomation.projectId;
            setHistory(null);
            navigate({
              to: "/session/$sessionId",
              params: { sessionId },
              search: { projectId },
            }).catch((error: unknown) => {
              console.error("Failed to open the automation session", error);
            });
          }}
          projectName={
            projects.find((item) => item.id === historyAutomation.projectId)?.name ??
            "Unknown project"
          }
        />
      ) : null}

      {deleting !== null ? (
        <AutomationDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
          pending={remove.isPending}
        />
      ) : null}
    </div>
  );
}
