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

// Live-session input bar on the TipTap chat-input kit: Enter sends (IME-safe,
// handled by the submit keymap) / Shift+Enter breaks the line; an in-flight
// turn blocks sending but not typing (onSubmit returns false → content stays).
// prompt/turnInProgress come from ChatSessionProvider — not props.
// Frame: CardFrame card stack — the editor Card plus a branch footer; the
// composer is the query consumer, so the git.branch call lives here.
// toolbar = surface-composed toolbar content (e.g. <ChatModelSelect/>).
export function ChatInputComposer({
  sessionRef,
  toolbar,
}: {
  sessionRef: SessionRef;
  toolbar?: ReactNode;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const branch = useQuery(orpcQueryUtils.git.branch.queryOptions({ input: { ref: sessionRef } }));
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
      return;
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
      <CardFrameFooter className="py-2">
        {branch.data?.current ? (
          <span
            className="text-muted-foreground flex items-center gap-1.5 px-3 text-xs"
            title="Current git branch"
          >
            <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{branch.data.current}</span>
          </span>
        ) : null}
      </CardFrameFooter>
    </CardFrame>
  );
}
