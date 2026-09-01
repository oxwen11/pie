import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import type { PropsWithChildren, ReactNode } from "react";
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
// Surface-specific input affordances are composed through slots.
export type ChatInputComposerProps = PropsWithChildren<{
  toolbar?: ReactNode;
}>;

export function ChatInputComposer({ children, toolbar }: ChatInputComposerProps) {
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
    <PromptInput
      onSubmit={(e) => {
        e.preventDefault();
        void controller?.submit();
      }}
    >
      <ChatInputProvider controller={controller}>
        <ChatInput />
        {children}
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
    </PromptInput>
  );
}
