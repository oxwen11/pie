import type {
  HarnessAgentId,
  PermissionMode,
  PromptPart,
  ReasoningEffort,
  SessionRef,
} from "@vibest/contract";
import { AbstractChat, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type { StoreApi } from "zustand/vanilla";

import type { AgentResponse } from "./agent-requests";
import { ChatState, type ChatStoreState } from "./chat-state";
import type { ChatSessionTransport } from "./chat-transport-port";

export interface ChatInit {
  sessionRef: SessionRef;
  transport: ChatSessionTransport;
}

/** Wire prompt parts → the user UIMessage other clients render. */
const toUserMessage = (messageId: string, parts: ReadonlyArray<PromptPart>): UIMessage => ({
  id: messageId,
  role: "user",
  parts: parts.map((part) =>
    part.type === "data-inspector" ? { type: "data-inspector", data: part.data } : part,
  ) as UIMessage["parts"],
});

// One observed turn's chunk sink: chunks are pushed in as they arrive and the
// AI-SDK's own reducer (readUIMessageStream — the same machinery the prompt
// stream and the server-side history folds use) turns them into evolving
// UIMessage snapshots.
type ObservedTurn = {
  readonly enqueue: (chunk: UIMessageChunk) => void;
  readonly close: () => void;
};

// Session controller: AbstractChat drives this client's own prompt stream
// (optimistic user push, chunk reduction) against a per-Chat zustand store;
// the persistent session subscription carries everything else — agent
// requests, server-derived status, and other clients' prompts and turns,
// which fold into the same store so every client shows the same transcript.
export class Chat extends AbstractChat<UIMessage> {
  // A Chat is bound to one harness for its whole life (a session's harness
  // never changes), so tool rendering dispatches on it. Only claude-code and
  // codex have dedicated renderers; any other harness falls back to the
  // generic tool card.
  readonly harnessAgentId: HarnessAgentId;
  readonly store: StoreApi<ChatStoreState>;
  readonly #state: ChatState;
  readonly #transport: ChatSessionTransport;
  readonly #unsubscribeRequests: () => void;
  readonly #observedTurns = new Map<string, ObservedTurn>();

  constructor({ sessionRef, transport }: ChatInit) {
    const state = new ChatState();
    super({
      id: sessionRef.sessionId,
      transport,
      state,
      // Turn ended: unanswered requests are stale — drop them so no ghost card
      // lingers in the transcript.
      onFinish: () => state.clearPendingRequests(),
    });
    this.harnessAgentId = sessionRef.harnessAgentId;
    this.store = state.store;
    this.#state = state;
    this.#transport = transport;
    this.#unsubscribeRequests = transport.subscribeSessionEvents({
      onRequest: (request) => state.addPendingRequest(request),
      onRequestResolved: (requestId) => state.removePendingRequest(requestId),
      // Server-derived status makes a turn another client is running visible
      // here (composer blocks, spinner shows). For the client that prompted,
      // these transitions land on the same values AbstractChat's own stream
      // lifecycle writes, so the two writers converge rather than fight.
      onStatus: (status) => {
        state.status = status;
      },
      // Native history backfill, delivered by the transport before any replay
      // or live event. Guarded on the transcript, not on status: a non-empty
      // transcript is already ahead of the disk (optimistic prompt or a
      // streamed turn), while a server-derived "streaming" status with an
      // empty transcript just means another client is mid-turn — exactly when
      // the backfill is still wanted.
      onHistory: (history) => {
        if (this.store.getState().messages.length > 0) return;
        this.messages = Array.from(history);
      },
      // The settled transcript advanced past the live view (un-completed turn
      // whose output the harness persisted anyway, or a truncated buffer that
      // was never rendered). Wholesale replace is only safe while nothing live
      // is in flight — a fresh turn's optimistic message or streaming chunks
      // must not be clobbered; a skipped reconcile converges on the next
      // reload instead.
      onHistoryReconcile: (history) => {
        if (history.length === 0) return;
        if (this.status === "streaming" || this.status === "submitted") return;
        if (this.#observedTurns.size > 0) return;
        this.messages = Array.from(history);
      },
      // Another client's prompt (the transport echoes this client's own too —
      // its optimistic message already carries the same id, so the upsert is
      // an idempotent no-op for the sender).
      onUserMessage: ({ messageId, parts }) => {
        if (this.store.getState().messages.some((m) => m.id === messageId)) return;
        state.pushMessage(toUserMessage(messageId, parts));
      },
      // Chunks of turns other clients drive (the transport already filters
      // this client's own turns) fold into the shared transcript.
      onTurnChunk: (turnId, chunk) => this.#observedTurn(turnId).enqueue(chunk),
      onTurnEnded: (turnId) => {
        this.#observedTurns.get(turnId)?.close();
        this.#observedTurns.delete(turnId);
      },
    });
  }

  #observedTurn(turnId: string): ObservedTurn {
    const existing = this.#observedTurns.get(turnId);
    if (existing) return existing;
    let controller: ReadableStreamDefaultController<UIMessageChunk> | undefined;
    const stream = new ReadableStream<UIMessageChunk>({
      start(c) {
        controller = c;
      },
    });
    void (async () => {
      try {
        // Seed the fold with a turn-derived id: a start chunk that carries no
        // messageId (claude-code) would otherwise leave the reader's constant
        // default id on every folded message, and two observed turns would
        // upsert into each other's slot. A start chunk that does carry one
        // (pi) still overrides this seed.
        const seed = { id: `observed-${turnId}`, role: "assistant", parts: [] } as UIMessage;
        for await (const message of readUIMessageStream({ message: seed, stream })) {
          this.#state.upsertMessage(message as UIMessage);
        }
      } catch (foldError) {
        console.error("Failed to fold observed turn", foldError);
      }
    })();
    let closed = false;
    const observed: ObservedTurn = {
      enqueue: (chunk) => {
        if (!closed) controller?.enqueue(chunk);
      },
      close: () => {
        if (closed) return;
        closed = true;
        controller?.close();
      },
    };
    this.#observedTurns.set(turnId, observed);
    return observed;
  }

  prompt = async (text: string): Promise<void> => {
    await this.sendMessage({ text });
  };

  // Model / reasoningEffort / permission are session config, changed via their own
  // calls — never bundled into a prompt turn.
  setModel = async (providerId: string, modelId: string): Promise<void> => {
    await this.#transport.setModel(providerId, modelId);
  };

  setReasoningEffort = async (reasoningEffort: ReasoningEffort): Promise<void> => {
    await this.#transport.setReasoningEffort(reasoningEffort);
  };

  setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    await this.#transport.setPermissionMode(mode);
  };

  respondToAgentRequest = async (requestId: string, response: AgentResponse): Promise<void> => {
    const request = this.store.getState().pendingRequests.find((r) => r.id === requestId);
    this.#state.removePendingRequest(requestId); // optimistic: the card closes immediately
    try {
      await this.#transport.respondToAgentRequest(requestId, response);
    } catch (respondError) {
      // Failure = the request is still pending server-side: restore the card so
      // the user can answer again (addPendingRequest is idempotent by id).
      console.error("Failed to respond to agent request", respondError);
      if (request) this.#state.addPendingRequest(request);
    }
  };

  dispose = (): void => {
    this.#unsubscribeRequests();
    for (const observed of this.#observedTurns.values()) observed.close();
    this.#observedTurns.clear();
  };
}
