import type { CreateWorktreeInput, Project } from "@getpie/contract";
import { PromptInputSubmit } from "@getpie/ui/ai-elements/prompt-input";
import { CardFrameHeader } from "@getpie/ui/components/card";
import { toast } from "sonner";

import { ModelSelectorPicker } from "@/components/model-selector/model-selector-picker";
import { ChatComposerFrame } from "@/features/chat/components/chat-composer-frame";
import { useChatComposerController } from "@/features/chat/components/input/use-chat-composer-controller";
import { useChatInputHasContent } from "@/features/chat/components/input/use-chat-input-has-content";
import { DraftEnvironmentSelect } from "@/features/projects/draft-environment-select";
import {
  DraftWorkspaceSelect,
  type DraftWorkspaceMode,
} from "@/features/projects/draft-workspace-select";
import { DraftWorktreeBaseSelect } from "@/features/projects/draft-worktree-base-select";
import { ProjectSelect } from "@/features/projects/project-select";
import type { ConnectedEnvironment } from "@/features/projects/use-connected-environments";
import { useDraftWorktree } from "@/features/projects/use-draft-worktree";

export function DraftComposer({
  draftModel,
  environmentId,
  environments,
  models,
  onEnvironmentChange,
  onModelChange,
  onProjectChange,
  onStart,
  projects,
  requireProject = false,
  selected,
  startPending,
}: {
  readonly draftModel: { provider: string; modelId: string } | undefined;
  readonly environmentId: string;
  readonly environments: ReadonlyArray<ConnectedEnvironment>;
  readonly models: Parameters<typeof ModelSelectorPicker>[0]["models"];
  readonly onEnvironmentChange: (environmentId: string) => void;
  readonly onModelChange: (provider: string, modelId: string) => void;
  readonly onProjectChange: (next: string | null) => void;
  readonly onStart: (text: string, worktree?: CreateWorktreeInput) => void;
  readonly projects: ReadonlyArray<Project>;
  /** Linked host — the picker never offers null, so send needs a project. */
  readonly requireProject?: boolean;
  readonly selected: Project | null;
  readonly startPending: boolean;
}) {
  const draftWorktree = useDraftWorktree(selected);
  const controller = useChatComposerController({
    onSubmit: (text) => {
      if (draftWorktree.gitState === "workspace-unavailable") {
        toast.error("The selected project folder is unavailable.");
        return false;
      }
      if (startPending) return false;
      // Linked host: nothing to send against until a Project is picked.
      if (requireProject && selected === null) return false;
      if (draftWorktree.mode === "worktree" && draftWorktree.worktree === undefined) {
        toast.error("Pick a base branch for the worktree.");
        return false;
      }
      onStart(text, draftWorktree.worktree);
      return false;
    },
  });
  const hasContent = useChatInputHasContent(controller);
  const selectedId = selected?.id ?? null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <ChatComposerFrame
        className="w-full max-w-2xl"
        controller={controller}
        minRows={2}
        header={
          <CardFrameHeader className="py-2">
            <div className="-mx-4 flex min-w-0 flex-wrap items-center gap-0">
              <DraftEnvironmentSelect
                environments={environments}
                onChange={onEnvironmentChange}
                value={environmentId}
              />
              <ProjectSelect
                onChange={onProjectChange}
                projects={projects}
                requireProject={requireProject}
                value={selectedId}
              />
              {draftWorktree.gitState === "not-repository" ? (
                <span className="text-muted-foreground px-2 text-xs">Not a Git repository</span>
              ) : null}
              {draftWorktree.gitState === "workspace-unavailable" ? (
                <span className="text-destructive px-2 text-xs">Workspace unavailable</span>
              ) : null}
              {draftWorktree.gitAvailable ? (
                <DraftWorkspaceControls
                  disabled={startPending || selectedId === null}
                  draftWorktree={draftWorktree}
                />
              ) : null}
            </div>
          </CardFrameHeader>
        }
        submit={
          <PromptInputSubmit
            disabled={
              (requireProject && selectedId === null) ||
              !hasContent ||
              draftWorktree.gitState === "workspace-unavailable" ||
              startPending ||
              (draftWorktree.mode === "worktree" && draftWorktree.worktree === undefined)
            }
          />
        }
        toolbar={
          <ModelSelectorPicker
            modelId={draftModel?.modelId}
            models={models}
            onChange={onModelChange}
            providerId={draftModel?.provider}
          />
        }
      />
    </div>
  );
}

function DraftWorkspaceControls({
  disabled,
  draftWorktree,
}: {
  disabled: boolean;
  draftWorktree: ReturnType<typeof useDraftWorktree>;
}) {
  const handleModeChange = (mode: DraftWorkspaceMode): void => {
    draftWorktree.setMode(mode);
  };
  const handleValueChange = (value: string | null): void => {
    draftWorktree.setWorktreeBaseOverride(value);
  };
  return (
    <>
      <DraftWorkspaceSelect
        disabled={disabled}
        mode={draftWorktree.mode}
        onModeChange={handleModeChange}
      />
      {draftWorktree.mode === "worktree" ? (
        <DraftWorktreeBaseSelect
          branch={draftWorktree.repositoryBranch}
          disabled={disabled}
          onValueChange={handleValueChange}
          value={draftWorktree.worktreeBase}
        />
      ) : null}
    </>
  );
}
