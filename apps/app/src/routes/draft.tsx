import type { ListSessionsOutput, SessionSummary } from "@getpie/contract";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Button } from "@getpie/ui/components/button";
import { Card, CardFrame, CardFrameAction, CardFrameHeader } from "@getpie/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
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
import { useAgentModels } from "@/features/chat/hooks/use-agent-models";
import { setPendingSessionStart } from "@/features/chat/pending-session-start";
import {
  DraftWorkspaceSelect,
  type DraftWorkspaceMode,
} from "@/features/projects/draft-workspace-select";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { ProjectSelect } from "@/features/projects/project-select";
import { useProject, useProjects } from "@/features/projects/use-projects";

type DraftSearch = {
  readonly projectId?: string;
  readonly provider?: string;
  readonly modelId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends string, V extends string>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

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
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<DraftWorkspaceMode>("project");
  const [worktreeBranch, setWorktreeBranch] = useState("");

  const projects = useProjects();
  const selected = useProject(search.projectId) ?? null;
  const gitStatus = useQuery({
    ...orpcQueryUtils.git.status.queryOptions({
      input: selected === null ? skipToken : { cwd: selected.path },
    }),
    retry: false,
  });
  const gitAvailable = gitStatus.isSuccess;
  const modelsQuery = useAgentModels(selected?.id);
  const defaultModel = modelsQuery.data?.defaultModel;

  useEffect(() => {
    if (!defaultModel || search.provider || search.modelId) return;
    void navigate({
      to: "/draft",
      search: (prev) => ({
        ...prev,
        provider: defaultModel.provider,
        modelId: defaultModel.modelId,
      }),
      replace: true,
    });
  }, [defaultModel, navigate, search.modelId, search.provider]);

  useEffect(() => {
    if (gitAvailable) return;
    setWorkspaceMode("project");
    setWorktreeBranch("");
  }, [gitAvailable, selected?.id]);

  const startSession = useMutation({
    mutationFn: async ({ text }: { text: string }) => {
      if (!selected) throw new Error("No project selected");
      const created = await orpcQueryUtils.agent.session.create.call({
        projectId: selected.id,
        ...(search.provider && search.modelId
          ? { provider: search.provider, modelId: search.modelId }
          : {}),
        ...(workspaceMode === "worktree"
          ? {
              worktree: worktreeBranch.trim().length > 0 ? { branch: worktreeBranch.trim() } : {},
            }
          : {}),
      });
      setPendingSessionStart({
        ref: created.ref,
        text,
        workspaceMode,
      });
      return created;
    },
    onSuccess: (created, { text }) => {
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

      navigate({
        to: "/session/$sessionId",
        params: { sessionId: created.ref.sessionId },
        search: { projectId: created.ref.projectId },
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
      startSession.mutate({ text });
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
            onImported={(project) =>
              navigate({ to: "/draft", search: { projectId: project.id }, replace: true })
            }
          />
        )}
      </Empty>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <CardFrame className="w-full max-w-2xl">
        <CardFrameHeader className="py-2">
          <ProjectSelect
            onChange={(next) =>
              navigate({
                to: "/draft",
                search: { projectId: next },
                replace: true,
              })
            }
            projects={projects.data}
            value={selected?.id ?? null}
          />
          {gitAvailable ? (
            <CardFrameAction>
              <DraftWorkspaceSelect
                branch={worktreeBranch}
                disabled={startSession.isPending || selected === null}
                mode={workspaceMode}
                onBranchChange={setWorktreeBranch}
                onModeChange={setWorkspaceMode}
              />
            </CardFrameAction>
          ) : null}
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
                  onChange={(provider, modelId) =>
                    navigate({
                      to: "/draft",
                      search: (prev) => ({ ...prev, provider, modelId }),
                      replace: true,
                    })
                  }
                />
              </PromptInputTools>
              <PromptInputSubmit disabled={!hasContent || !selected || startSession.isPending} />
            </PromptInputToolbar>
          </ChatInputProvider>
        </Card>
      </CardFrame>
    </div>
  );
}
