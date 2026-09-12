import type { SessionRef } from "@getpie/contract";
import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Card, CardFrame, CardFrameFooter, CardFrameHeader } from "@getpie/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon, NavigationIcon, SquareIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useStore } from "zustand";

import { useChatHandle } from "@/features/chat/runtime/use-chat-handle";
import { useLatestRef } from "@/hooks/use-latest-ref";
import { useAppClients } from "@/lib/app-clients";

import { ChatInputQueue } from "./chat-input-queue";
import { useChatSession } from "./chat-session-context";
import { ChatInput } from "./input/chat-input";
import { ChatInputProvider } from "./input/chat-input-provider";
import { createChatBaseExtensions } from "./input/extensions/chat-base-extensions";
import { createSubmitKeymap } from "./input/extensions/keymaps";
import { useChatInputController } from "./input/use-chat-input-controller";
import { useChatInputHasContent } from "./input/use-chat-input-has-content";

// Live-session input bar on the TipTap chat-input kit: Enter sends (IME-safe,
// handled by the submit keymap) / Shift+Enter breaks the line. Stop and Send
// are mutually exclusive: empty streaming → Stop; any draft (or idle) → Send
// (queues a follow-up while a turn is in flight). prompt comes from
// ChatSessionProvider — not props. The CardFrame header lists queued prompts
// as editable rows (steering first); the footer shows the session workspace's
// git availability and current branch.
export function ChatInputComposer({
  sessionRef,
  toolbar,
}: {
  sessionRef: SessionRef;
  toolbar?: ReactNode;
}) {
  const { orpcQueryUtils } = useAppClients();
  const branch = useQuery(orpcQueryUtils.git.branch.queryOptions({ input: { ref: sessionRef } }));
  const currentBranch =
    branch.data?.kind === "repository" ? (branch.data.current ?? undefined) : undefined;
  const workspaceUnavailable = branch.data?.kind === "workspace-unavailable";
  const chat = useChatHandle(sessionRef);
  const { prompt, interrupt, replaceQueue, store } = useChatSession();
  const status = useStore(store, (s) => s.status);
  const pendingPrompt = useStore(store, (s) => s.pendingPrompt);
  const canInterrupt = status === "streaming";
  const hasQueued = pendingPrompt.steering.length > 0 || pendingPrompt.followUp.length > 0;
  const workspaceUnavailableRef = useLatestRef(workspaceUnavailable);

  const controller = useChatInputController({
    initialContent: chat.composerDraft,
    onDispose: (doc) => {
      chat.setComposerDraft(doc);
    },
    // Order is a hard constraint: base extensions first, submit keymap last —
    // otherwise bare Enter is consumed by the default newline behavior before
    // the keymap ever sees it.
    extensions: (self) => [
      ...createChatBaseExtensions(),
      createSubmitKeymap({ onSubmit: () => void self.submit() }),
    ],
    onSubmit: (text) => {
      // Missing workspace: don't send, don't clear. A running turn still
      // accepts the send as a follow-up.
      if (workspaceUnavailableRef.current) return false;
      prompt(text, canInterrupt ? "followUp" : undefined);
      chat.setComposerDraft(undefined);
      return undefined;
    },
  });

  const hasContent = useChatInputHasContent(controller);

  return (
    <CardFrame>
      {hasQueued ? (
        <CardFrameHeader className="min-w-0 grid-rows-none gap-1 px-3 py-2">
          <ChatInputQueue onReplace={replaceQueue} pending={pendingPrompt} />
        </CardFrameHeader>
      ) : null}
      <Card
        render={
          <PromptInput
            className="divide-y-0"
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
            <PromptInputTools>{toolbar}</PromptInputTools>
            <ChatComposerActions
              canInterrupt={canInterrupt}
              hasContent={hasContent}
              interrupt={interrupt}
              workspaceUnavailable={workspaceUnavailable}
            />
          </PromptInputToolbar>
        </ChatInputProvider>
      </Card>
      <CardFrameFooter className="px-3 py-2">
        <ChatComposerGitStatus
          currentBranch={currentBranch}
          isPending={branch.isPending}
          kind={branch.data?.kind}
          workspaceUnavailable={workspaceUnavailable}
        />
      </CardFrameFooter>
    </CardFrame>
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
