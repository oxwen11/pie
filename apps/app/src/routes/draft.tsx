import type { ListSessionsOutput, SessionSummary } from "@pie/contract";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@pie/ui/ai-elements/prompt-input";
import { Button } from "@pie/ui/components/button";
import { Card, CardFrame, CardFrameHeader } from "@pie/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pie/ui/components/empty";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useChatManager } from "@/features/chat/runtime/chat-context";
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
  const manager = useChatManager();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const projects = useProjects();
  const selected = useProject(search.projectId) ?? null;
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

  const startSession = useMutation({
    mutationFn: async ({ text }: { text: string }) => {
      if (!selected) throw new Error("No project selected");
      const ref = await orpcQueryUtils.agent.session.create.call({
        projectId: selected.id,
        ...(search.provider && search.modelId
          ? { provider: search.provider, modelId: search.modelId }
          : {}),
      });
      void manager.chatFor(ref).prompt(text);
      return ref;
    },
    onSuccess: (ref, { text }) => {
      const listKey = orpcQueryUtils.agent.session.list.queryOptions({
        input: { projectId: ref.projectId, archived: false },
      }).queryKey;

      queryClient.setQueryData<ListSessionsOutput>(listKey, (prev) => {
        if (prev?.some((session) => session.sessionId === ref.sessionId)) return prev;
        const optimistic: SessionSummary = {
          projectId: ref.projectId,
          sessionId: ref.sessionId,
          title: text,
          archived: false,
          createdAt: new Date().toISOString(),
          historyAvailable: true,
        };
        return [...(prev ?? []), optimistic];
      });

      navigate({
        to: "/session/$sessionId",
        params: { sessionId: ref.sessionId },
        search: { projectId: ref.projectId },
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
