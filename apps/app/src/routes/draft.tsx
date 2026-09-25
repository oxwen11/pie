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
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { useChatManager } from "@/features/chat/runtime/chat-context";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import type { ProjectGroup, ProjectSelection } from "@/features/projects/project-select";
import {
  useConnectedEnvironments,
  type ConnectedEnvironment,
} from "@/features/projects/use-connected-environments";
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

/** Imported projects per Environment, switcher order, oldest-first within each. */
function buildDraftGroups(
  environments: ReadonlyArray<ConnectedEnvironment>,
  projectLists: ReadonlyArray<UseQueryResult<ReadonlyArray<Project>>>,
): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  for (let index = 0; index < environments.length; index += 1) {
    const environment = environments[index];
    const list = projectLists[index]?.data;
    if (environment === undefined || list === undefined) continue;
    const projects = Array.from(list)
      .filter((project) => project.type !== "chat")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (projects.length === 0) continue;
    groups.push({
      environmentId: environment.environmentId,
      environmentTitle: environment.title,
      projects,
    });
  }
  return groups;
}

/** The picked project plus the Environment that owns it, or null. */
function findSelection(
  groups: ReadonlyArray<ProjectGroup>,
  environmentId: string,
  projectId: string | undefined,
): ProjectSelection | null {
  if (projectId === undefined) return null;
  const own = groups.find((group) => group.environmentId === environmentId);
  const project = own?.projects.find((candidate) => candidate.id === projectId);
  if (own === undefined || project === undefined) return null;
  return {
    environmentId: own.environmentId,
    environmentTitle: own.environmentTitle,
    project,
  };
}

function DraftPage({ environmentId }: { readonly environmentId: string }) {
  const { localEnvironmentId, environmentRpc } = Route.useRouteContext();
  const orpcQueryUtils = useCatalogOrpc();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const chats = useChatManager();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  // One project.list per connected Environment — same prefixed keys the
  // sidebar and catalog worker use, so this subscribes to warm caches.
  const environments = useConnectedEnvironments();
  const projectLists = useQueries({
    queries: environments.map((environment) =>
      environmentRpc.for(environment.environmentId).project.list.queryOptions(),
    ),
  });

  const groups = buildDraftGroups(environments, projectLists);
  const selected = findSelection(groups, environmentId, search.projectId);
  // Linked host: chat-folder allocation (`~/Pie`) is local-only, so the draft
  // requires an imported Project there.
  const requireProject = environmentId !== localEnvironmentId;
  const modelsQuery = useQuery(
    orpcQueryUtils.agent.listModels.queryOptions({
      input: selected?.project.id ? { projectId: selected.project.id } : {},
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
      let projectId = selected?.project.id;
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

  if (projectLists.some((list) => list.isPending)) {
    return <Loader />;
  }

  const ownList =
    projectLists[environments.findIndex((entry) => entry.environmentId === environmentId)];
  if (ownList?.isError) {
    return (
      <DraftProjectsError message={ownList.error.message} onRetry={() => void ownList.refetch()} />
    );
  }

  if (groups.length === 0 && search.projectId === undefined) {
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

  return (
    <DraftComposer
      draftModel={draftModel}
      group={groups.length > 1}
      groups={groups}
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
              // Non-project chats allocate locally — drop the environment hint.
              const { projectId: _removed, environmentId: _dropped, ...rest } = prev;
              return rest;
            }
            return {
              ...prev,
              projectId: next.project.id,
              environmentId: next.environmentId,
            };
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
      requireProject={requireProject}
      selected={selected}
      startPending={startSession.isPending}
    />
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
