import type { SessionRef, SessionWorkspace } from "@getpie/contract";
import { Loader } from "@getpie/ui/ai-elements/loader";
import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/conversation";
import { Chat } from "@/features/chat/chat";
import {
  clearPendingSessionStart,
  type PendingSessionStart,
} from "@/features/chat/pending-session-start";
import { useChatManager } from "@/features/chat/runtime/chat-context";

type BootstrapStep = "worktree" | "session";

const routeApi = getRouteApi("/session/$sessionId");

function BootstrapTranscript({
  text,
  step,
  showWorktree,
}: {
  text: string;
  step: BootstrapStep;
  showWorktree: boolean;
}) {
  return (
    <Conversation>
      <ConversationContent
        scrollClassName="scrollbar-thin"
        className="mx-auto w-full max-w-4xl min-w-80"
      >
        <div className="flex justify-end">
          <div className="bg-muted max-w-[85%] rounded-2xl px-4 py-2 text-sm">{text}</div>
        </div>
        {showWorktree && step === "worktree" ? (
          <Shimmer className="text-sm">Creating worktree…</Shimmer>
        ) : null}
        {step === "session" ? <Shimmer className="text-sm">Starting conversation…</Shimmer> : null}
        <Loader />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

export function SessionStartBootstrap({ bootstrap }: { bootstrap: PendingSessionStart }) {
  const { orpcQueryUtils } = routeApi.useRouteContext();
  const navigate = useNavigate();
  const manager = useChatManager();
  const [step, setStep] = useState<BootstrapStep>(
    bootstrap.workspaceMode === "worktree" ? "worktree" : "session",
  );
  const [ready, setReady] = useState<{ ref: SessionRef; workspace: SessionWorkspace } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdWorktreePath: string | undefined;

    const run = async () => {
      let sessionCwd = bootstrap.projectPath;
      let gitBranch: string | undefined;

      try {
        if (bootstrap.workspaceMode === "worktree") {
          setStep("worktree");
          const branch = bootstrap.worktreeBranch.trim();
          const worktree = await orpcQueryUtils.git.worktreeCreate.call({
            cwd: bootstrap.projectPath,
            ...(branch.length > 0 ? { branch } : {}),
          });
          if (cancelled) {
            await orpcQueryUtils.git.worktreeRemove.call({ path: worktree.path }).catch(() => {});
            return;
          }
          createdWorktreePath = worktree.path;
          sessionCwd = worktree.path;
          gitBranch = worktree.branch;
        }

        setStep("session");
        const created = await orpcQueryUtils.agent.session.create.call({
          projectId: bootstrap.projectId,
          sessionId: bootstrap.sessionId,
          cwd: sessionCwd,
          ...(gitBranch !== undefined ? { gitBranch } : {}),
          ...(bootstrap.provider && bootstrap.modelId
            ? { provider: bootstrap.provider, modelId: bootstrap.modelId }
            : {}),
        });

        if (cancelled) return;

        await manager.chatFor(created.ref).prompt(bootstrap.text);
        if (cancelled) return;

        setReady({ ref: created.ref, workspace: created.workspace });
      } catch (error) {
        if (cancelled) return;
        if (createdWorktreePath !== undefined) {
          await orpcQueryUtils.git.worktreeRemove
            .call({ path: createdWorktreePath })
            .catch(() => {});
        }
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to start session: ${message}`);
        navigate({ to: "/draft", search: { projectId: bootstrap.projectId } });
      } finally {
        clearPendingSessionStart(bootstrap.sessionId);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [bootstrap, manager, navigate, orpcQueryUtils]);

  if (ready) {
    return <Chat cwd={ready.workspace.cwd} sessionRef={ready.ref} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BootstrapTranscript
        showWorktree={bootstrap.workspaceMode === "worktree"}
        step={step}
        text={bootstrap.text}
      />
    </div>
  );
}
