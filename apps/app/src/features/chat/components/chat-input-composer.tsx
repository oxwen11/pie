import type { SessionRef } from "@getpie/contract";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Card, CardFrame, CardFrameFooter } from "@getpie/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
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

// Live-session input bar: Enter sends (submit keymap), Shift+Enter breaks the
// line. The CardFrame footer shows the session workspace's current git branch.
export function ChatInputComposer({
  sessionRef,
  toolbar,
}: {
  sessionRef: SessionRef;
  toolbar?: ReactNode;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const branch = useQuery(orpcQueryUtils.git.branch.queryOptions({ input: { ref: sessionRef } }));
  const currentBranch = branch.data?.current;
  const { prompt, interrupt, turnInProgress, store } = useChatSession();
  const status = useStore(store, (s) => s.status);
  const canInterrupt = status === "streaming";
  const turnInProgressRef = useLatestRef(turnInProgress);

  const controller = useChatInputController({
    // Order is a hard constraint: base extensions first, submit keymap last —
    // otherwise bare Enter is consumed by the default newline behavior before
    // the keymap ever sees it.
    extensions: (self) => [
      ...createChatBaseExtensions(),
      createSubmitKeymap({ onSubmit: () => void self.submit() }),
    ],
    onSubmit: (text) => {
      // Turn in progress: don't send, don't clear.
      if (turnInProgressRef.current) return false;
      prompt(text);
      return undefined;
    },
  });

  const hasContent = useChatInputHasContent(controller);

  return (
    <CardFrame>
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
            <PromptInputSubmit
              aria-label={canInterrupt ? "Stop generating" : "Send message"}
              disabled={!canInterrupt && (!hasContent || turnInProgress)}
              onClick={canInterrupt ? () => void interrupt() : undefined}
              status={status}
              type={canInterrupt ? "button" : "submit"}
            />
          </PromptInputToolbar>
        </ChatInputProvider>
      </Card>
      <CardFrameFooter className="px-3 py-2">
        <span
          className="text-muted-foreground flex h-4 min-w-0 items-center gap-1.5 text-xs"
          title={currentBranch ? "Current git branch" : undefined}
        >
          {branch.isPending ? (
            <span aria-hidden="true" className="bg-muted h-2 w-24 animate-pulse rounded-sm" />
          ) : currentBranch ? (
            <>
              <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{currentBranch}</span>
            </>
          ) : null}
        </span>
      </CardFrameFooter>
    </CardFrame>
  );
}
