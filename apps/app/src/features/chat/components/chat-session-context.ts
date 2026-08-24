import { createContext, useContext } from "react";
import type { StoreApi } from "zustand/vanilla";

import type { AgentRequest, AgentResponse } from "@/features/chat/runtime/agent-requests";
import type { ChatStoreState } from "@/features/chat/runtime/chat-state";

export type ChatSessionValue = {
  sessionId: string;
  store: StoreApi<ChatStoreState>;
  prompt: (text: string) => void;
  interrupt: () => Promise<void>;
  respondToRequest: (requestId: string, response: AgentResponse) => void;
  turnInProgress: boolean;
};

export const ChatSessionContext = createContext<ChatSessionValue | null>(null);

export function useChatSession(): ChatSessionValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used within <ChatSessionProvider>");
  return ctx;
}

export type { AgentRequest };
