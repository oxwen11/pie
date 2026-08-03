import type { PermissionMode, PromptPart, ReasoningEffort, SessionRef } from "@vibest/contract";
import type { ChatTransport as AiChatTransport, UIMessage, UIMessageChunk } from "ai";

import type { AgentRequest, AgentResponse } from "./agent-requests";

// The seam between Chat orchestration and any concrete wire implementation.
// Chat and ChatManager depend only on this port; the oRPC binding
// (OrpcChatSessionTransport) implements it and is injected at the composition
// root, so nothing in the core knows about oRPC or the WebSocket client.
/**
 * The session's server-derived chat status: the runtime phase folded onto the
 * AI-SDK vocabulary ("submitted" stays a sender-local optimistic state and
 * never comes from the server).
 */
export type SessionChatStatus = "streaming" | "ready" | "error";

export interface ChatSessionTransport extends AiChatTransport<UIMessage> {
  // The session control plane rides the same session transport as the prompt
  // stream, but sits outside the AI SDK transport interface — so the port adds
  // it explicitly. The subscription is persistent (constructor-to-dispose):
  // it hydrates from the current snapshot, then follows live events, so a
  // client that never prompted still tracks requests and status driven from
  // another client.
  // Turn events for turns *other clients* drive are included: the transport
  // filters out turns this client prompted itself (their chunks arrive via
  // sendMessages and fold through the AI-SDK machinery), so `onTurnChunk` /
  // `onTurnEnded` fire only for turns to observe. `onUserMessage` fires for
  // every accepted prompt including this client's own — dedupe by messageId
  // (the sender's optimistic message already carries it).
  subscribeSessionEvents(handlers: {
    onRequest: (request: AgentRequest) => void;
    onRequestResolved?: (requestId: string) => void;
    onStatus?: (status: SessionChatStatus) => void;
    // Settled native history, delivered once at first attach and strictly
    // before any replayed or live event — the transcript floor is laid before
    // the live tail lands on top. Never fires for a harness without a history
    // read, or when the read fails (best-effort).
    onHistory?: (messages: ReadonlyArray<UIMessage>) => void;
    // A fresh history read after the live view may have diverged from the
    // settled transcript: a turn that ended un-completed (the harness may have
    // retried and persisted a reply the live stream never carried), or a turn
    // whose buffered replay was truncated. The consumer decides whether it is
    // safe to apply (e.g. skips while a new turn is already streaming).
    onHistoryReconcile?: (messages: ReadonlyArray<UIMessage>) => void;
    onUserMessage?: (message: {
      readonly messageId: string;
      readonly parts: ReadonlyArray<PromptPart>;
    }) => void;
    onTurnChunk?: (turnId: string, chunk: UIMessageChunk) => void;
    onTurnEnded?: (turnId: string) => void;
  }): () => void;
  /**
   * Resolves normally when the request is no longer pending — including when
   * another client answered it first (the server's "not pending" is an
   * outcome, not a failure, from the responder's point of view).
   */
  respondToAgentRequest(requestId: string, response: AgentResponse): Promise<void>;
  // Session-scoped config setters — separate session calls, never bundled into
  // a prompt turn. The transport already knows its SessionRef. The model is
  // the flat providerId/modelId pair — always together, modelId alone is only
  // unique within its provider.
  setModel(providerId: string, modelId: string): Promise<void>;
  setReasoningEffort(reasoningEffort: ReasoningEffort): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /**
   * The session's native history as final-form UIMessages, or `null` when this
   * harness serves no history — capability absence is a normal outcome here,
   * not an error. All three harnesses serve history today, so `null` is the
   * degraded path, not the common one.
   */
  getMessages(): Promise<readonly UIMessage[] | null>;
}

// Binds a SessionRef to a transport. ChatManager holds one of these instead of
// the wire client, so swapping the oRPC binding for anything else is a one-line
// change at the composition root.
export type ChatSessionTransportFactory = (sessionRef: SessionRef) => ChatSessionTransport;
