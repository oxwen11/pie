import { PromptInputButton, PromptInputSubmit } from "@getpie/ui/ai-elements/prompt-input";
import { CardFrameFooter, CardFrameHeader } from "@getpie/ui/components/card";
import { cn } from "@getpie/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useStore } from "zustand";

import { useChatHandle } from "@/features/chat/runtime/use-chat-handle";
import { useLatestRef } from "@/hooks/use-latest-ref";
import { useEnvironmentOrpc } from "@/lib/environment-orpc";
import type { EnvironmentSessionRef } from "@/lib/session-ref";

import { ChatComposerFrame } from "./chat-composer-frame";
import { ChatInputQueue } from "./chat-input-queue";
import { omitEchoedFollowUps, promoteQueuedFollowUp } from "./chat-input-queue-model";
import { useChatSession } from "./chat-session-context";
import { useChatComposerController } from "./input/use-chat-composer-controller";
import { useChatInputHasContent } from "./input/use-chat-input-has-content";
import { useChatInputMultiline } from "./input/use-chat-input-multiline";

// Live-session input bar. Stop and Send are mutually exclusive: empty streaming
// → Stop; any draft (or idle) → Send (queues a follow-up while a turn is in
// flight). Empty Enter steers the first follow-up. The header lists queued
// prompts; the footer shows the workspace's git availability and branch.
export function SessionComposer({
  className,
  sessionRef,
  toolbar,
}: {
  className: string;
  sessionRef: EnvironmentSessionRef;
  toolbar?: ReactNode;
}) {
  const orpcQueryUtils = useEnvironmentOrpc();
  const branch = useQuery(
    orpcQueryUtils.git.branch.queryOptions({ input: { ref: sessionRef.ref } }),
  );
  const currentBranch =
    branch.data?.kind === "repository" ? (branch.data.current ?? undefined) : undefined;
  const workspaceUnavailable = branch.data?.kind === "workspace-unavailable";
  const chat = useChatHandle(sessionRef);
  const { interrupt, replaceQueue, store } = useChatSession();
  const status = useStore(store, (s) => s.status);
  const pendingPrompt = useStore(store, (s) => s.pendingPrompt);
  const canInterrupt = status === "streaming";
  const turnInProgress = status === "submitted" || status === "streaming";
  const hasQueued = pendingPrompt.steering.length > 0 || pendingPrompt.followUp.length > 0;
  const workspaceUnavailableRef = useLatestRef(workspaceUnavailable);
  const turnInProgressRef = useLatestRef(turnInProgress);
  const pendingRef = useLatestRef(pendingPrompt);
  // Follow-ups whose queue echo has not landed. Empty Enter before that echo
  // waits and steers the first follow-up when it does.
  const inflightFollowUps = useRef<string[]>([]);
  const steerOnEcho = useRef(false);

  useEffect(() => {
    if (!turnInProgress) {
      inflightFollowUps.current = [];
      steerOnEcho.current = false;
      return;
    }
    inflightFollowUps.current = omitEchoedFollowUps(inflightFollowUps.current, pendingPrompt);
    if (pendingPrompt.followUp.length === 0) {
      if (inflightFollowUps.current.length === 0) steerOnEcho.current = false;
      return;
    }
    if (!steerOnEcho.current) return;
    steerOnEcho.current = false;
    replaceQueue(promoteQueuedFollowUp(pendingPrompt, 0));
  }, [turnInProgress, pendingPrompt, replaceQueue]);

  const controller = useChatComposerController({
    initialContent: chat.composerDraft,
    onDispose: (doc) => {
      chat.setComposerDraft(doc);
    },
    onSubmit: (text) => {
      // Missing workspace: don't send, don't clear. A running turn still
      // accepts the send as a follow-up.
      if (workspaceUnavailableRef.current) return false;
      const busy = turnInProgressRef.current;
      if (busy) inflightFollowUps.current.push(text);
      void chat.prompt(text, busy ? "followUp" : undefined).catch((error: unknown) => {
        if (busy) {
          const index = inflightFollowUps.current.lastIndexOf(text);
          if (index !== -1) inflightFollowUps.current.splice(index, 1);
          if (inflightFollowUps.current.length === 0 && pendingRef.current.followUp.length === 0) {
            steerOnEcho.current = false;
          }
        }
        console.error("Failed to prompt", error);
      });
      chat.setComposerDraft(undefined);
      return undefined;
    },
    onEmptySubmit: () => {
      if (!turnInProgressRef.current) return;
      const pending = pendingRef.current;
      if (pending.followUp.length > 0) {
        steerOnEcho.current = false;
        replaceQueue(promoteQueuedFollowUp(pending, 0));
        return;
      }
      inflightFollowUps.current = omitEchoedFollowUps(inflightFollowUps.current, pending);
      if (inflightFollowUps.current.length > 0) steerOnEcho.current = true;
    },
  });

  const hasContent = useChatInputHasContent(controller);
  const multiline = useChatInputMultiline(controller);

  return (
    <ChatComposerFrame
      className={cn("mt-2 mb-4", className)}
      controller={controller}
      footer={
        <CardFrameFooter className="px-3 py-2">
          <ChatComposerGitStatus
            currentBranch={currentBranch}
            isPending={branch.isPending}
            kind={branch.data?.kind}
            workspaceUnavailable={workspaceUnavailable}
          />
        </CardFrameFooter>
      }
      layout={multiline ? undefined : "inline"}
      header={
        hasQueued ? (
          <CardFrameHeader className="min-w-0 grid-rows-none gap-1 px-3 py-2">
            <ChatInputQueue onReplace={replaceQueue} pending={pendingPrompt} />
          </CardFrameHeader>
        ) : undefined
      }
      submit={
        <ChatComposerActions
          canInterrupt={canInterrupt}
          hasContent={hasContent}
          interrupt={interrupt}
          workspaceUnavailable={workspaceUnavailable}
        />
      }
      toolbar={toolbar}
    />
  );
}

function ChatComposerActions({
  canInterrupt,
  hasContent,
  interrupt,
  workspaceUnavailable,
}: {
  canInterrupt: boolean;
  hasContent: boolean;
  interrupt: () => Promise<void>;
  workspaceUnavailable: boolean;
}) {
  // Exactly one primary action: Stop while streaming with an empty draft,
  // otherwise Send (disabled when empty / workspace missing).
  if (canInterrupt && !hasContent) {
    return (
      <PromptInputButton
        aria-label="Stop generating"
        onClick={() => void interrupt()}
        variant="default"
      >
        <SquareIcon className="size-4" />
      </PromptInputButton>
    );
  }

  return (
    <PromptInputSubmit aria-label="Send message" disabled={!hasContent || workspaceUnavailable} />
  );
}

function ChatComposerGitStatus({
  currentBranch,
  isPending,
  kind,
  workspaceUnavailable,
}: {
  currentBranch: string | undefined;
  isPending: boolean;
  kind: "repository" | "not-repository" | "workspace-unavailable" | undefined;
  workspaceUnavailable: boolean;
}) {
  return (
    <span className="flex h-4 min-w-0 items-center text-xs">
      {gitStatusLabel({ currentBranch, isPending, kind, workspaceUnavailable })}
    </span>
  );
}

function gitStatusLabel({
  currentBranch,
  isPending,
  kind,
  workspaceUnavailable,
}: {
  currentBranch: string | undefined;
  isPending: boolean;
  kind: "repository" | "not-repository" | "workspace-unavailable" | undefined;
  workspaceUnavailable: boolean;
}): ReactNode {
  if (isPending) {
    return (
      <span aria-hidden="true" className="bg-muted h-2 w-24 rounded-sm motion-safe:animate-pulse" />
    );
  }
  if (currentBranch) {
    return (
      <span
        className="text-muted-foreground flex min-w-0 items-center gap-1.5"
        title="Current git branch"
      >
        <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{currentBranch}</span>
      </span>
    );
  }
  if (kind === "not-repository") {
    return <span className="text-muted-foreground">Not a Git repository</span>;
  }
  if (workspaceUnavailable) {
    return <span className="text-destructive">Workspace unavailable</span>;
  }
  return null;
}
