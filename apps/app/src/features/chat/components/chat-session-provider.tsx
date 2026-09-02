import type { SessionRef } from "@getpie/contract";
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

  const prompt = useCallback(
    (text: string, delivery?: "steer" | "followUp") => {
      chat.prompt(text, delivery).catch((error: unknown) => {
        console.error("Failed to prompt", error);
      });
    },
    [chat],
  );
  const interrupt = useCallback(() => chat.interrupt(), [chat]);
  const replaceQueue = useCallback<ChatSessionValue["replaceQueue"]>(
    (pending) => {
      chat.replaceQueue(pending).catch((error: unknown) => {
        console.error("Failed to replace queue", error);
      });
    },
    [chat],
  );
  const respondToRequest = useCallback<ChatSessionValue["respondToRequest"]>(
    (requestId, response) => {
      chat.respondToAgentRequest(requestId, response).catch((error: unknown) => {
        console.error("Failed to respond to agent request", error);
      });
    },
    [chat],
  );

  const value = useMemo<ChatSessionValue>(
    () => ({
      sessionId: sessionRef.sessionId,
      store: chat.store,
      prompt,
      interrupt,
      replaceQueue,
      respondToRequest,
      turnInProgress,
    }),
    [sessionRef.sessionId, chat, prompt, interrupt, replaceQueue, respondToRequest, turnInProgress],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}
