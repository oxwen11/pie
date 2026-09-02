import type { CreateWorktreeInput, ListSessionsOutput, SessionSummary } from "@getpie/contract";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Button } from "@getpie/ui/components/button";
import { Card, CardFrame, CardFrameHeader } from "@getpie/ui/components/card";
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
import { FolderPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { DraftModelSelect } from "@/features/chat/components/draft-model-select";
import { ChatInput } from "@/features/chat/components/input/chat-input";
import { ChatInputProvider } from "@/features/chat/components/input/chat-input-provider";
import { createChatBaseExtensions } from "@/features/chat/components/input/extensions/chat-base-extensions";
import { createSubmitKeymap } from "@/features/chat/components/input/extensions/keymaps";
import { useChatInputController } from "@/features/chat/components/input/use-chat-input-controller";
import { useChatInputHasContent } from "@/features/chat/components/input/use-chat-input-has-content";
import { useChatManager } from "@/features/chat/runtime/chat-context";
import { DraftWorkspaceSelect } from "@/features/projects/draft-workspace-select";
import { DraftWorktreeBaseSelect } from "@/features/projects/draft-worktree-base-select";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { ProjectSelect } from "@/features/projects/project-select";
import { useDraftWorktree } from "@/features/projects/use-draft-worktree";
import { useProject, useProjects } from "@/features/projects/use-projects";

type DraftSearch = {
  readonly projectId?: string;
  readonly provider?: string;
  readonly modelId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends keyof DraftSearch>(
  key: K,
  value: DraftSearch[K],
): Pick<DraftSearch, K> | undefined =>
  value === undefined ? undefined : ({ [key]: value } as Pick<DraftSearch, K>);

export const Route = createFileRoute("/draft")({
  validateSearch: (search: Record<string, unknown>): DraftSearch => ({
    ...optional("projectId", asText(search.projectId)),
    ...optional("provider", asText(search.provider)),
    ...optional("modelId", asText(search.modelId)),
  }),
  component: DraftRoute,
});

function DraftRoute() {
  const { orpcQueryUtils } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const chats = useChatManager();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const projects = useProjects();
  const selected = useProject(search.projectId) ?? null;
  const draftWorktree = useDraftWorktree(selected);
  const modelsQuery = useQuery(
    orpcQueryUtils.agent.listModels.queryOptions({
      input: selected?.id ? { projectId: selected.id } : {},
    }),
  );
  const defaultModel = modelsQuery.data?.defaultModel;

  useEffect(() => {
    if (!defaultModel || search.provider || search.modelId) return;
    navigate({
      to: "/draft",
      search: (prev) => ({
        ...prev,
        provider: defaultModel.provider,
        modelId: defaultModel.modelId,
      }),
      replace: true,
    }).catch((error: unknown) => {
      console.error("Failed to apply default draft model", error);
    });
  }, [defaultModel, navigate, search.modelId, search.provider]);

  const startSession = useMutation({
    mutationFn: async ({ text, worktree }: { text: string; worktree?: CreateWorktreeInput }) => {
      if (!selected) throw new Error("No project selected");
      const created = await orpcQueryUtils.agent.session.create.call({
        projectId: selected.id,
        ...(search.provider && search.modelId
          ? { provider: search.provider, modelId: search.modelId }
          : undefined),
        ...(worktree !== undefined ? { worktree } : undefined),
      });
      return { created, text };
    },
    onSuccess: ({ created, text }) => {
      const listKey = orpcQueryUtils.agent.session.list.queryOptions({
        input: { projectId: created.ref.projectId, archived: false },
      }).queryKey;

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
        .chatFor(created.ref)
        .prompt(text)
        .catch((error: unknown) => {
          console.error("Failed to start session prompt", error);
        });

      navigate({
        to: "/session/$sessionId",
        params: { sessionId: created.ref.sessionId },
        search: { projectId: created.ref.projectId },
      }).catch((error: unknown) => {
        console.error("Failed to open the new session", error);
      });
    },
    onError: (error) => {
      toast.error(`Failed to start session: ${error.message}`);
    },
  });

  const controller = useChatInputController({
    extensions: (self) => [
      ...createChatBaseExtensions({
        placeholder: () => "Ask Pi anything...",
      }),
      createSubmitKeymap({ onSubmit: () => void self.submit() }),
    ],
    onSubmit: (text) => {
      if (!selected) {
        toast.error("Pick a project before sending.");
        return false;
      }
      if (startSession.isPending) return false;
      if (draftWorktree.mode === "worktree" && draftWorktree.worktree === undefined) {
        toast.error("Pick a base branch for the worktree.");
        return false;
      }
      startSession.mutate({
        text,
        ...(draftWorktree.worktree !== undefined
          ? { worktree: draftWorktree.worktree }
          : undefined),
      });
      return false;
    },
  });

  const hasContent = useChatInputHasContent(controller);

  if (projects.isPending) {
    return <Loader />;
  }

  if (projects.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t load your projects: {projects.error.message}
        </p>
        <Button onClick={() => void projects.refetch()} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  if (projects.data.length === 0) {
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
            Choose a local folder for your coding agent to work in. You can start a chat right after
            importing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => setImportOpen(true)}>Import project</Button>
        </EmptyContent>
        {importOpen && (
          <ImportProjectDialog
            onClose={() => setImportOpen(false)}
            onImported={(project) => {
              navigate({
                to: "/draft",
                search: { projectId: project.id },
                replace: true,
              }).catch((error: unknown) => {
                console.error("Failed to open the imported project", error);
              });
            }}
          />
        )}
      </Empty>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <CardFrame className="w-full max-w-2xl">
        <CardFrameHeader className="py-2">
          <div className="-mx-5.5 flex min-w-0 flex-wrap items-center gap-0">
            <ProjectSelect
              onChange={(next) => {
                navigate({
                  to: "/draft",
                  search: { projectId: next },
                  replace: true,
                }).catch((error: unknown) => {
                  console.error("Failed to select draft project", error);
                });
              }}
              projects={projects.data}
              value={selected?.id ?? null}
            />
            {draftWorktree.gitAvailable ? (
              <>
                <DraftWorkspaceSelect
                  disabled={startSession.isPending || selected === null}
                  mode={draftWorktree.mode}
                  onModeChange={draftWorktree.setMode}
                />
                {draftWorktree.mode === "worktree" ? (
                  <DraftWorktreeBaseSelect
                    branch={draftWorktree.gitBranch.data}
                    disabled={
                      startSession.isPending ||
                      selected === null ||
                      draftWorktree.gitBranch.isPending
                    }
                    onValueChange={draftWorktree.setWorktreeBaseOverride}
                    value={draftWorktree.worktreeBase}
                  />
                ) : null}
              </>
            ) : null}
            <Button
              className="ms-auto"
              disabled={selected === null}
              onClick={() => {
                if (selected === null) return;
                navigate({
                  to: "/automations",
                  search: { create: true, projectId: selected.id },
                }).catch((error: unknown) => {
                  console.error("Failed to open the automation editor", error);
                });
              }}
              size="sm"
              variant="ghost"
            >
              Schedule…
            </Button>
          </div>
        </CardFrameHeader>
        <Card
          render={
            <PromptInput
              onSubmit={(e) => {
                e.preventDefault();
                void controller?.submit();
              }}
            />
          }
        >
          <ChatInputProvider controller={controller}>
            <ChatInput />
            <PromptInputToolbar>
              <PromptInputTools>
                <DraftModelSelect
                  projectId={selected?.id}
                  providerId={search.provider}
                  modelId={search.modelId}
                  onChange={(provider, modelId) => {
                    navigate({
                      to: "/draft",
                      search: (prev) => ({ ...prev, provider, modelId }),
                      replace: true,
                    }).catch((error: unknown) => {
                      console.error("Failed to set the draft model", error);
                    });
                  }}
                />
              </PromptInputTools>
              <PromptInputSubmit
                disabled={
                  !hasContent ||
                  !selected ||
                  startSession.isPending ||
                  (draftWorktree.mode === "worktree" && draftWorktree.worktree === undefined)
                }
              />
            </PromptInputToolbar>
          </ChatInputProvider>
        </Card>
      </CardFrame>
    </div>
  );
}
