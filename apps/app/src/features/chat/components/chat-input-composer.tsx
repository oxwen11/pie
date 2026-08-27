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
import { useRouteContext } from "@tanstack/react-router";
import { GitBranchIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { useLatestRef } from "@/hooks/use-latest-ref";

import { useChatSession } from "./chat-session-context";
import { ChatInput } from "./input/chat-input";
import { ChatInputProvider } from "./input/chat-input-provider";
import { createChatBaseExtensions } from "./input/extensions/chat-base-extensions";
import { createSubmitKeymap } from "./input/extensions/keymaps";
import { useChatInputController } from "./input/use-chat-input-controller";
import { useChatInputHasContent } from "./input/use-chat-input-has-content";

// Live-session input bar on the TipTap chat-input kit: Enter sends (IME-safe,
// handled by the submit keymap) / Shift+Enter breaks the line. An in-flight
// turn queues the send as a Pi follow-up instead of blocking. prompt comes
// from ChatSessionProvider — not props. The CardFrame header lists queued
// prompts; the footer shows the session workspace's git availability and
// current branch.
export function ChatInputComposer({
  sessionRef,
  toolbar,
}: {
  sessionRef: SessionRef;
  toolbar?: ReactNode;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const branch = useQuery(orpcQueryUtils.git.branch.queryOptions({ input: { ref: sessionRef } }));
  const currentBranch = branch.data?.kind === "repository" ? branch.data.current : undefined;
  const workspaceUnavailable = branch.data?.kind === "workspace-unavailable";
  const { prompt, interrupt, store } = useChatSession();
  const status = useStore(store, (s) => s.status);
  const pendingPrompt = useStore(store, (s) => s.pendingQueue);
  const canInterrupt = status === "streaming";
  const queueLines = [...pendingPrompt.steering, ...pendingPrompt.followUp];
  const workspaceUnavailableRef = useLatestRef(workspaceUnavailable);

  const controller = useChatInputController({
    // Order is a hard constraint: base extensions first, submit keymap last —
    // otherwise bare Enter is consumed by the default newline behavior before
    // the keymap ever sees it.
    extensions: (self) => [
      ...createChatBaseExtensions(),
      createSubmitKeymap({ onSubmit: () => void self.submit() }),
    ],
    onSubmit: (text) => {
      // Missing workspace: don't send, don't clear. A running turn still
      // accepts the send — it becomes a Pi follow-up.
      if (workspaceUnavailableRef.current) return false;
      prompt(text);
      return undefined;
    },
  });

  const hasContent = useChatInputHasContent(controller);

  return (
    <CardFrame>
      {queueLines.length > 0 ? (
        <CardFrameHeader className="min-w-0 grid-rows-none gap-1 py-2">
          <ul aria-label="Queued messages" className="flex w-full min-w-0 flex-col gap-1">
            {queueLines.map((text, index) => (
              <li
                className="text-muted-foreground truncate text-sm"
                key={`${index}:${text}`}
                title={text}
              >
                {text}
              </li>
            ))}
          </ul>
        </CardFrameHeader>
      ) : null}
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
            <PromptInputTools>{toolbar}</PromptInputTools>
            <div className="flex items-center gap-1">
              {canInterrupt ? (
                <PromptInputButton
                  aria-label="Stop generating"
                  onClick={() => void interrupt()}
                  variant="ghost"
                >
                  <SquareIcon className="size-4" />
                </PromptInputButton>
              ) : null}
              <PromptInputSubmit
                aria-label="Send message"
                disabled={!hasContent || workspaceUnavailable}
              />
            </div>
          </PromptInputToolbar>
        </ChatInputProvider>
      </Card>
      <CardFrameFooter className="px-3 py-2">
        <span className="flex h-4 min-w-0 items-center text-xs">
          {branch.isPending ? (
            <span aria-hidden="true" className="bg-muted h-2 w-24 animate-pulse rounded-sm" />
          ) : currentBranch ? (
            <span
              className="text-muted-foreground flex min-w-0 items-center gap-1.5"
              title="Current git branch"
            >
              <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{currentBranch}</span>
            </span>
          ) : branch.data?.kind === "not-repository" ? (
            <span className="text-muted-foreground">Not a Git repository</span>
          ) : workspaceUnavailable ? (
            <span className="text-destructive">Workspace unavailable</span>
          ) : null}
        </span>
      </CardFrameFooter>
    </CardFrame>
  );
}
