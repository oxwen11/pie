import type {
  AgentRequest,
  PromptPart,
  SessionMessageChunkEvent,
  SessionPendingPrompt,
  SessionPhase,
  SessionRuntimeSnapshot,
  SessionScopedEvent,
  SessionScopedEventBody,
} from "@getpie/contract";
import type { UIMessage, UIMessageChunk } from "ai";

import type { AgentResponse } from "./agent-requests";
import { Chat } from "./chat";
import type { ChatSessionTransport, ChatTransportEvent } from "./chat-transport-port";

export const ref = {
  projectId: "project-1",
  sessionId: "session-1",
} as const;

// Chunk folds run on microtasks (ReadableStream consumers): settle before
// asserting on folded messages.
export const settle = async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

export class FakeTransport implements ChatSessionTransport {
  onEvent: ((event: ChatTransportEvent) => void) | null = null;
  disposed = 0;
  history: readonly UIMessage[] | null = null;
  // When set, getMessages blocks on it — for tests that race the history
  // floor against live traffic.
  historyGate: Promise<void> | null = null;
  getMessagesCalls = 0;
  promptCalls: Array<{
    messageId: string;
    parts: ReadonlyArray<PromptPart>;
    delivery?: "steer" | "followUp";
  }> = [];
  promptError: Error | null = null;
  // When set, prompt blocks on it — for tests where the RPC is still in flight
  // (a dropped socket queues it until the link reconnects).
  promptGate: Promise<void> | null = null;
  responded: Array<{ requestId: string; response: AgentResponse }> = [];
  interruptCalls = 0;
  replaceQueueCalls: SessionPendingPrompt[] = [];
  replaceQueueError: Error | null = null;
  replaceQueueGate: Promise<void> | null = null;

  subscribe(onEvent: (event: ChatTransportEvent) => void): () => void {
    this.onEvent = onEvent;
    return () => {
      this.disposed += 1;
    };
  }
  prompt = async (input: {
    messageId: string;
    parts: ReadonlyArray<PromptPart>;
    delivery?: "steer" | "followUp";
  }) => {
    this.promptCalls.push(input);
    if (this.promptGate) await this.promptGate;
    if (this.promptError) throw this.promptError;
    return { turnId: "turn-receipt", started: true };
  };
  getMessages = async () => {
    this.getMessagesCalls += 1;
    if (this.historyGate) await this.historyGate;
    return this.history;
  };
  respondToAgentRequest = async (requestId: string, response: AgentResponse) => {
    this.responded.push({ requestId, response });
  };
  interrupt = async () => {
    this.interruptCalls += 1;
  };
  replaceQueue = async (pending: SessionPendingPrompt) => {
    this.replaceQueueCalls.push(pending);
    if (this.replaceQueueGate) await this.replaceQueueGate;
    if (this.replaceQueueError) throw this.replaceQueueError;
  };
}

export const makeChat = (options?: { onTerminated?: () => void }) => {
  const transport = new FakeTransport();
  const chat = new Chat({ sessionRef: ref, transport, onTerminated: options?.onTerminated });
  const emit = (event: ChatTransportEvent) => transport.onEvent?.(event);
  const attach = async (snapshot: Partial<SessionRuntimeSnapshot>) => {
    emit({
      type: "attached",
      snapshot: {
        ref,
        status: { phase: "idle" },
        activeTurn: null,
        activePrompt: null,
        pendingRequests: [],
        pendingPrompt: { steering: [], followUp: [] },
        cursor: 0,
        ...snapshot,
      },
    });
    await settle();
  };
  const live = (seq: number, body: SessionScopedEventBody & { phase?: SessionPhase }) =>
    emit({ seq, ref, ...body } as SessionScopedEvent);
  return { chat, transport, attach, live, emit };
};

export const chunkEvent = (
  seq: number,
  turnId: string,
  chunk: UIMessageChunk,
): SessionMessageChunkEvent =>
  ({ seq, ref, type: "session.message.chunk", turnId, chunk }) as SessionMessageChunkEvent;

type ActiveTurnInit = Partial<NonNullable<SessionRuntimeSnapshot["activeTurn"]>> & {
  turnId: string;
  chunks: SessionMessageChunkEvent[];
};

export const activeTurn = (
  init: ActiveTurnInit,
): NonNullable<SessionRuntimeSnapshot["activeTurn"]> => ({
  messageId: null,
  complete: false,
  truncated: false,
  ...init,
});

export const textChunks = (id: string, text: string): UIMessageChunk[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: text },
  { type: "text-end", id },
];

export const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

export const assistantText = (message: UIMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

export const toolRequest: AgentRequest = {
  type: "tool",
  id: "request-1",
  toolName: "Bash",
  input: { command: "pwd" },
  actions: [{ id: "allow", label: "Allow", behavior: "allow" }],
  native: null,
};
