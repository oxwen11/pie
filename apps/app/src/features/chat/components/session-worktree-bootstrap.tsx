import type { PrepareSessionOutput } from "@getpie/contract";
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
  clearPendingWorktreeSetup,
  type PendingWorktreeSetup,
} from "@/features/chat/pending-worktree-setup";
import { useChatManager } from "@/features/chat/runtime/chat-context";

type BootstrapStep = "worktree" | "starting";

const routeApi = getRouteApi("/session/$sessionId");

function BootstrapTranscript({ text, step }: { text: string; step: BootstrapStep }) {
  return (
    <Conversation>
      <ConversationContent
        scrollClassName="scrollbar-thin"
        className="mx-auto w-full max-w-4xl min-w-80"
      >
        <div className="flex justify-end">
          <div className="bg-muted max-w-[85%] rounded-2xl px-4 py-2 text-sm">{text}</div>
        </div>
        {step === "worktree" ? (
          <Shimmer className="text-sm">Creating worktree…</Shimmer>
        ) : (
          <Shimmer className="text-sm">Starting conversation…</Shimmer>
        )}
        <Loader />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

export function SessionWorktreeBootstrap({
  prepared,
  pending,
}: {
  prepared: PrepareSessionOutput;
  pending: PendingWorktreeSetup;
}) {
  const { orpcQueryUtils } = routeApi.useRouteContext();
  const navigate = useNavigate();
  const manager = useChatManager();
  const [step, setStep] = useState<BootstrapStep>("worktree");
  const [workspace, setWorkspace] = useState(prepared.workspace);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdWorktreePath: string | undefined;

    const run = async () => {
      try {
        setStep("worktree");
        const branch = pending.worktreeBranch.trim();
        const worktree = await orpcQueryUtils.git.worktreeCreate.call({
          cwd: pending.projectPath,
          ...(branch.length > 0 ? { branch } : {}),
        });
        if (cancelled) {
          await orpcQueryUtils.git.worktreeRemove.call({ path: worktree.path }).catch(() => {});
          return;
        }
        createdWorktreePath = worktree.path;

        setStep("starting");
        const relocated = await orpcQueryUtils.agent.session.relocateWorkspace.call({
          ref: pending.ref,
          cwd: worktree.path,
          gitBranch: worktree.branch,
        });
        if (cancelled) return;

        setWorkspace(relocated);
        await manager.chatFor(pending.ref).prompt(pending.text);
        if (cancelled) return;

        setReady(true);
      } catch (error) {
        if (cancelled) return;
        if (createdWorktreePath !== undefined) {
          await orpcQueryUtils.git.worktreeRemove
            .call({ path: createdWorktreePath })
            .catch(() => {});
        }
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to create worktree: ${message}`);
        navigate({ to: "/draft", search: { projectId: pending.ref.projectId } });
      } finally {
        clearPendingWorktreeSetup(pending.ref.sessionId);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [manager, navigate, orpcQueryUtils, pending]);

  if (ready) {
    return <Chat cwd={workspace.cwd} sessionRef={prepared.ref} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BootstrapTranscript step={step} text={pending.text} />
    </div>
  );
}
