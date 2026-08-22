import type { SessionRef } from "@pie/contract";
import { useCallback, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";

import { selectTurnInProgress, useChatHandle } from "@/features/chat/runtime/use-chat-handle";

import { ChatSessionContext, type ChatSessionValue } from "./chat-session-context";

export function ChatSessionProvider({
  sessionRef,
  children,
}: {
  sessionRef: SessionRef;
  children: ReactNode;
}) {
  const chat = useChatHandle(sessionRef);
  const turnInProgress = useStore(chat.store, selectTurnInProgress);

  const prompt = useCallback((text: string) => chat.prompt(text), [chat]);

  const value = useMemo<ChatSessionValue>(
    () => ({
      sessionId: sessionRef.sessionId,
      store: chat.store,
      prompt,
      respondToRequest: chat.respondToAgentRequest,
      turnInProgress,
    }),
    [sessionRef.sessionId, chat, prompt, turnInProgress],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}
