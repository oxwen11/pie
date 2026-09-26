import type {
  CreateWorktreeInput,
  ListSessionsOutput,
  Project,
  SessionSummary,
} from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { useChatManager } from "@/features/chat/runtime/chat-context";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { useProject, useProjects } from "@/features/projects/use-projects";
import { EnvironmentOrpcProvider, useCatalogOrpc } from "@/lib/environment-orpc";

import { DraftComposer } from "./draft-composer";

type DraftSearch = {
  readonly projectId?: string;
  readonly environmentId?: string;
  readonly provider?: string;
  readonly modelId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends keyof DraftSearch>(
  key: K,
  value: DraftSearch[K],
): Partial<Pick<DraftSearch, K>> => {
  const result: Partial<Pick<DraftSearch, K>> = {};
  if (value !== undefined) result[key] = value;
  return result;
};

export const Route = createFileRoute("/draft")({
  validateSearch: (search: Record<string, unknown>): DraftSearch => ({
    ...optional("projectId", asText(search.projectId)),
    ...optional("environmentId", asText(search.environmentId)),
    ...optional("provider", asText(search.provider)),
    ...optional("modelId", asText(search.modelId)),
  }),
  component: DraftRoute,
});

function DraftRoute() {
  const { localEnvironmentId, environmentRpc } = Route.useRouteContext();
  const search = Route.useSearch();
  const environmentId = search.environmentId ?? localEnvironmentId;
  return (
    <EnvironmentOrpcProvider orpc={environmentRpc.for(environmentId)}>
      <DraftPage environmentId={environmentId} />
    </EnvironmentOrpcProvider>
  );
}

function DraftPage({ environmentId }: { readonly environmentId: string }) {
  const orpcQueryUtils = useCatalogOrpc();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const chats = useChatManager();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const projects = useProjects();
  const selected = useProject(search.projectId) ?? null;
  const modelsQuery = useQuery(
    orpcQueryUtils.agent.listModels.queryOptions({
      input: selected?.id ? { projectId: selected.id } : {},
    }),
  );
  const defaultModel = modelsQuery.data?.defaultModel;
  const draftModel =
    search.provider !== undefined && search.modelId !== undefined
      ? { provider: search.provider, modelId: search.modelId }
      : defaultModel;

  const startSession = useMutation({
    mutationKey: orpcQueryUtils.agent.session.create.key(),
    mutationFn: async ({ text, worktree }: { text: string; worktree?: CreateWorktreeInput }) => {
      let projectId = selected?.id;
      if (projectId === undefined) {
        const allocated = await orpcQueryUtils.project.allocateChatProjectDir.call();
        const projectListKey = orpcQueryUtils.project.list.queryOptions().queryKey;
        queryClient.setQueryData<ReadonlyArray<Project>>(projectListKey, (prev) => {
          if (prev?.some((project) => project.id === allocated.id)) return prev;
          return [...(prev ?? []), allocated];
        });
        projectId = allocated.id;
      }
      const created = await orpcQueryUtils.agent.session.create.call({
        projectId,
        ...(draftModel !== undefined
          ? { provider: draftModel.provider, modelId: draftModel.modelId }
          : undefined),
        ...(worktree !== undefined ? { worktree } : undefined),
      });
      return { created, text };
    },
    onSuccess: ({ created, text }) => {
      const listKey = orpcQueryUtils.agent.session.list.queryOptions({
        input: { projectId: created.ref.projectId, archived: false },
      }).queryKey;

      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.agent.listModels.key(),
      });

      queryClient.setQueryData<ListSessionsOutput>(listKey, (prev) => {
        if (prev?.some((session) => session.sessionId === created.ref.sessionId)) return prev;
        const optimistic: SessionSummary = {
          projectId: created.ref.projectId,
          sessionId: created.ref.sessionId,
          title: text,
          archived: false,
          createdAt: new Date().toISOString(),
          historyAvailable: true,
        };
        return [...(prev ?? []), optimistic];
      });

      // Create already persisted cwd (and the worktree, when requested). Prompt
      // only opens Pi — fire-and-forget so spawn does not block the jump.
      void chats
        .chatFor({ environmentId, ref: created.ref })
        .prompt(text)
        .catch((error: unknown) => {
          console.error("Failed to start session prompt", error);
        });

      navigate({
        to: "/session/$sessionId",
        params: { sessionId: created.ref.sessionId },
        search: { projectId: created.ref.projectId, environmentId },
      }).catch((error: unknown) => {
        console.error("Failed to open the new session", error);
      });
    },
    onError: (error) => {
      toast.error(`Failed to start session: ${error.message}`);
    },
  });

  if (projects.isPending) {
    return <Loader />;
  }

  if (projects.isError) {
    return (
      <DraftProjectsError
        message={projects.error.message}
        onRetry={() => void projects.refetch()}
      />
    );
  }

  if (projects.data.length === 0 && search.projectId === undefined) {
    return (
      <DraftEmptyImport
        importOpen={importOpen}
        onCloseImport={() => setImportOpen(false)}
        onImported={(projectId, importedEnvironmentId) => {
          navigate({
            to: "/draft",
            search: { projectId, environmentId: importedEnvironmentId },
            replace: true,
          }).catch((error: unknown) => {
            console.error("Failed to open the imported project", error);
          });
        }}
        onOpenImport={() => setImportOpen(true)}
      />
    );
  }

  // Do not expose the composer until Pi confirms at least one usable model.
  // On an unconfigured machine the first prompt would fail after creating a session.
  if (modelsQuery.isPending) return <Loader />;
  if (modelsQuery.isError) {
    return <DraftModelsError onRetry={() => void modelsQuery.refetch()} />;
  }
  if (modelsQuery.data.models.length === 0) {
    return <DraftNoModels onRetry={() => void modelsQuery.refetch()} />;
  }

  return (
    <DraftComposer
      draftModel={draftModel}
      models={modelsQuery.data?.models ?? []}
      onModelChange={(provider, modelId) => {
        navigate({
          to: "/draft",
          search: (prev) => ({ ...prev, provider, modelId }),
          replace: true,
        }).catch((error: unknown) => {
          console.error("Failed to set the draft model", error);
        });
      }}
      onProjectChange={(next) => {
        navigate({
          to: "/draft",
          search: (prev) => {
            if (next === null) {
              const { projectId: _removed, ...rest } = prev;
              return { ...rest, environmentId };
            }
            return { ...prev, projectId: next, environmentId };
          },
          replace: true,
        }).catch((error: unknown) => {
          console.error("Failed to select draft project", error);
        });
      }}
      onStart={(text, worktree) => {
        startSession.mutate({
          text,
          ...(worktree !== undefined ? { worktree } : undefined),
        });
      }}
      projects={projects.data ?? []}
      selected={selected}
      startPending={startSession.isPending}
    />
  );
}

function DraftModelsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <p className="text-muted-foreground text-sm">
        Couldn&apos;t check available models. Retry before starting a session.
      </p>
      <Button onClick={onRetry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}

function DraftNoModels({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h1>No model provider connected</h1>
        </EmptyTitle>
        <EmptyDescription>
          pie needs a model with working credentials before you can start a session. Run{" "}
          <code>pi</code> in a terminal and use <code>/login</code> to connect a provider via OAuth
          or an API key, then retry.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onRetry} variant="outline">
          Retry
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function DraftProjectsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <p className="text-muted-foreground text-sm">Couldn&apos;t load your projects: {message}</p>
      <Button onClick={onRetry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}

function DraftEmptyImport({
  importOpen,
  onCloseImport,
  onImported,
  onOpenImport,
}: {
  importOpen: boolean;
  onCloseImport: () => void;
  onImported: (projectId: string, environmentId: string) => void;
  onOpenImport: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlusIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h1>Import your first project</h1>
        </EmptyTitle>
        <EmptyDescription>
          Choose a folder for your coding agent to work in. You can start a chat right after
          importing.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onOpenImport}>Import project</Button>
      </EmptyContent>
      {importOpen ? (
        <ImportProjectDialog
          onClose={onCloseImport}
          onImported={(project, importedEnvironmentId) => {
            onImported(project.id, importedEnvironmentId);
          }}
        />
      ) : null}
    </Empty>
  );
}
