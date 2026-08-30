import type {
  PromptPart,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionScopedEvent,
} from "@getpie/contract";
import { generateId, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type { StoreApi } from "zustand/vanilla";

import type { AgentRequest, AgentResponse } from "./agent-requests";
import { ChatState, type ChatStoreState } from "./chat-state";
import type { ChatSessionTransport } from "./chat-transport-port";
import { sanitizeTail } from "./sanitize-tail";

export interface ChatInit {
  sessionRef: SessionRef;
  transport: ChatSessionTransport;
  /**
   * Fired once, when the server declares this session's stream over for good
   * (closed or deleted). The owner's cue to stop caching this Chat — the
   * instance stays usable for whoever is currently rendering it, showing the
   * terminal error, and is simply never handed out again.
   */
  onTerminated?: () => void;
}

/** Wire prompt parts → the user UIMessage every client renders. */
const toUserMessage = (messageId: string, parts: ReadonlyArray<PromptPart>): UIMessage => ({
  id: messageId,
  role: "user",
  parts: parts.map((part) =>
    part.type === "data-inspector" ? { type: "data-inspector", data: part.data } : part,
  ) as UIMessage["parts"],
});

const retryNoticeFrom = (chunk: UIMessageChunk): string | undefined => {
  if (chunk.type !== "data-retry") return undefined;
  const data = chunk.data as {
    readonly errorMessage?: unknown;
    readonly attempt?: unknown;
    readonly maxAttempts?: unknown;
  };
  const errorMessage = typeof data.errorMessage === "string" ? data.errorMessage : "";
  const reason =
    errorMessage === "Connection error." ? "Couldn't reach the model provider" : errorMessage;
  const attempt = typeof data.attempt === "number" ? data.attempt : undefined;
  const maxAttempts = typeof data.maxAttempts === "number" ? data.maxAttempts : undefined;
  const suffix =
    attempt !== undefined && maxAttempts !== undefined
      ? `Retrying (${attempt}/${maxAttempts})…`
      : "Retrying…";
  return reason ? `${reason}. ${suffix}` : suffix;
};

const isPromptEvent = (
  type: SessionScopedEvent["type"],
): type is "session.prompt.submitted" | "session.prompt.rejected" =>
  type === "session.prompt.submitted" || type === "session.prompt.rejected";

// One turn's chunk sink: chunks are pushed in as they arrive and the AI-SDK's
// own reducer (readUIMessageStream — the same machinery the server-side
// history folds use) turns them into evolving UIMessage snapshots. Those
// snapshots write the live-assistant slot only.
type TurnFold = {
  readonly enqueue: (chunk: UIMessageChunk) => void;
  readonly close: () => void;
};

// Session controller, single-consumer: every message — this client's own
// turns included — folds out of the one persistent subscription, so all
// clients run the identical rendering path and none needs to claim turns.
// Sending is fire-and-forget: prompt() parks the optimistic user in
// pendingUsers and submits the RPC; the turn's content comes back through
// the subscription like everyone else's, into liveAssistant.
//
// Transcript sources stay separate: settled is only getMessages(),
// pendingUsers is unconfirmed prompts, liveAssistant is the open fold.
// Hydrate / live events never write settled, so they cannot clobber an
// in-flight bubble or a streaming tail.
export class Chat {
  readonly store: StoreApi<ChatStoreState>;
  readonly #state: ChatState;
  readonly #transport: ChatSessionTransport;
  readonly #onTerminated: (() => void) | undefined;
  readonly #unsubscribe: () => void;
  readonly #turnFolds = new Map<string, TurnFold>();
  // Turns whose live rendering was abandoned (buffer truncated, replay gap):
  // their chunks are skipped and the turn is recovered from the history read
  // once it ends.
  readonly #recoverTurnIds = new Set<string>();
  // Turns whose stream carried an error chunk: Pi may retry internally and still
  // complete, with the retried tail persisted but never streamed — reconcile
  // from history at turn end regardless of outcome.
  readonly #erroredTurnIds = new Set<string>();
  #cursor = 0;
  #historyLoaded = false;
  // Non-null while the history floor is loading: live events queue here so
  // nothing folds ahead of the floor. Drained (in order, cursor-gated) once
  // the floor and the snapshot hydration are down.
  #queuedEvents: SessionScopedEvent[] | null = null;
  // The snapshot the floor's hydration will use. A re-attach while the floor
  // is still loading replaces it, so hydration always folds the freshest
  // server state — never a stale first snapshot over a newer one.
  #floorSnapshot: SessionRuntimeSnapshot | null = null;
  // The settled slot is known to miss content (a turn completed inside a
  // subscription drop). Cleared when a reconcile lands.
  #needsReconcile = false;

  constructor({ sessionRef: _sessionRef, transport, onTerminated }: ChatInit) {
    this.#state = new ChatState();
    this.store = this.#state.store;
    this.#transport = transport;
    this.#onTerminated = onTerminated;
    this.#unsubscribe = transport.subscribe((event) => {
      if (event.type === "attached") this.#hydrate(event.snapshot);
      else if (event.type === "closed") this.#terminate(event.reason);
      else if (this.#queuedEvents) this.#queuedEvents.push(event);
      else this.#apply(event);
    });
  }

  // ---------------------------------------------------------------------
  // Event application (increments)
  // ---------------------------------------------------------------------

  #apply(event: SessionScopedEvent): void {
    if (this.#state.snapshot.terminated) return;
    if (event.seq <= this.#cursor) return;
    this.#cursor = event.seq;
    switch (event.type) {
      case "session.message.chunk":
        this.#observeChunk(event.chunk);
        // Retry is UI status, not transcript — keep it out of the message fold.
        if (event.chunk.type === "data-retry") break;
        if (!this.#recoverTurnIds.has(event.turnId)) {
          if (event.chunk.type === "error") this.#erroredTurnIds.add(event.turnId);
          this.#turnFold(event.turnId).enqueue(event.chunk);
        }
        break;
      case "session.prompt.submitted":
        // The sender already cleared its stale error synchronously in prompt().
        // Only a genuinely unseen prompt may clear here: a delayed self-echo
        // must not erase a newer prompt RPC failure.
        if (this.#pushPendingUser(event.messageId, event.parts)) {
          this.#state.setRetryNotice(undefined);
          this.#state.setError(undefined);
        }
        break;
      case "session.prompt.rejected":
        this.#state.removePendingUser(event.messageId);
        if (this.#state.snapshot.inFlightPrompt?.id === event.messageId) {
          this.#state.setInFlightPrompt(null);
        }
        break;
      case "session.turn.started":
        // Park the previous live assistant on settled before a new fold
        // overwrites the slot, so pending users still render between them.
        this.#state.promoteLive();
        break;
      case "session.turn.ended":
        this.#turnFolds.get(event.turnId)?.close();
        this.#turnFolds.delete(event.turnId);
        this.#state.setRetryNotice(undefined);
        this.#state.clearPendingRequests();
        if (
          event.outcome !== "completed" ||
          this.#recoverTurnIds.has(event.turnId) ||
          this.#erroredTurnIds.has(event.turnId) ||
          this.#needsReconcile
        ) {
          void this.#reconcileHistory();
        }
        this.#recoverTurnIds.delete(event.turnId);
        this.#erroredTurnIds.delete(event.turnId);
        break;
      case "session.request.asked":
        this.#handleRequest(event.request);
        break;
      case "session.request.replied":
      case "session.request.rejected":
        this.#state.removePendingRequest(event.requestId);
        break;
      case "session.crashed":
        for (const fold of this.#turnFolds.values()) fold.close();
        this.#turnFolds.clear();
        this.#state.promoteLive();
        this.#state.clearPendingRequests();
        break;
      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
    // Phase is copied off the event (the runtime stamps its post-fold phase).
    // Prompt events still must not clear inFlightPrompt: they carry a pre-turn
    // idle phase that would drop the sender's spinner before turn.started.
    if (event.phase !== undefined && event.type !== "session.message.chunk") {
      this.#state.setPhase(event.phase);
      if (!isPromptEvent(event.type)) this.#state.setInFlightPrompt(null);
    }
  }

  #terminate(reason: "session_closed" | "session_deleted"): void {
    if (this.#state.snapshot.terminated) return;
    for (const fold of this.#turnFolds.values()) fold.close();
    this.#turnFolds.clear();
    this.#queuedEvents = null;
    this.#state.setError(
      new Error(reason === "session_deleted" ? "Session deleted" : "Session closed"),
    );
    this.#state.setTerminated();
    this.#onTerminated?.();
  }

  // ---------------------------------------------------------------------
  // Hydration (state sync at attach / re-attach)
  // ---------------------------------------------------------------------

  #hydrate(snapshot: SessionRuntimeSnapshot): void {
    if (!this.#historyLoaded) {
      this.#historyLoaded = true;
      this.#queuedEvents = [];
      this.#floorSnapshot = snapshot;
      void this.#loadHistoryFloor();
      return;
    }
    if (this.#queuedEvents !== null) {
      this.#floorSnapshot = snapshot;
      return;
    }
    this.#hydrateFromSnapshot(snapshot);
  }

  async #loadHistoryFloor(): Promise<void> {
    try {
      const history = await this.#transport.getMessages();
      if (this.#state.snapshot.terminated) return;
      if (history !== null) this.#state.setSettled(Array.from(history), { retainLive: true });
      this.#state.setHistoryStatus(history === null ? "unavailable" : "settled");
    } catch (historyError) {
      console.error("Failed to load session history", historyError);
      if (this.#state.snapshot.terminated) return;
      this.#state.setHistoryStatus("unavailable");
    }
    const snapshot = this.#floorSnapshot;
    this.#floorSnapshot = null;
    if (snapshot) this.#hydrateFromSnapshot(snapshot, { skipGapCheck: true });
    const queued = this.#queuedEvents ?? [];
    this.#queuedEvents = null;
    for (const event of queued) this.#apply(event);
  }

  #hydrateFromSnapshot(
    snapshot: SessionRuntimeSnapshot,
    options?: { readonly skipGapCheck?: boolean },
  ): void {
    if (this.#state.snapshot.terminated) return;
    // A snapshot below our cursor means the server's seq counter restarted —
    // its in-memory session was rebuilt (a server restart, or a close and
    // reopen). Nothing else can produce it: within one incarnation the counter
    // only grows, and an attach applies its snapshot before folding any live
    // event of that cycle. Keeping the old cursor would silently discard the
    // whole next turn as "already applied", so rejoin as a newcomer and let
    // the settled transcript supply what came before.
    if (snapshot.cursor < this.#cursor) {
      this.#cursor = 0;
      this.#needsReconcile = true;
    }
    this.#state.setPendingRequests([]);
    for (const request of snapshot.pendingRequests) this.#handleRequest(request);

    const activeTurn = snapshot.activeTurn;

    for (const [turnId, fold] of this.#turnFolds) {
      if (activeTurn?.turnId !== turnId) {
        fold.close();
        this.#turnFolds.delete(turnId);
        this.#state.promoteLive();
        this.#needsReconcile = true;
      }
    }
    // On first attach (cursor 0) a buffer marked complete is history, not
    // recovery — the floor covers it, and replaying would float a stale
    // reply above the transcript.
    const stale = this.#cursor === 0 && activeTurn?.complete === true;

    const activePrompt = snapshot.activePrompt;
    let appliedPromptSeq: number | undefined;
    if (
      activePrompt &&
      activePrompt.seq > this.#cursor &&
      (!stale || activePrompt.seq === snapshot.cursor)
    ) {
      appliedPromptSeq = activePrompt.seq;
      if (this.#pushPendingUser(activePrompt.messageId, activePrompt.parts)) {
        this.#state.setRetryNotice(undefined);
        this.#state.setError(undefined);
      }
    }

    for (const chunkEvent of activeTurn?.chunks ?? []) {
      if (
        chunkEvent.seq > this.#cursor &&
        (appliedPromptSeq === undefined || chunkEvent.seq > appliedPromptSeq)
      ) {
        this.#observeChunk(chunkEvent.chunk);
      }
    }

    for (const turnId of this.#recoverTurnIds) {
      if (activeTurn?.turnId !== turnId) {
        this.#recoverTurnIds.delete(turnId);
        this.#erroredTurnIds.delete(turnId);
        this.#needsReconcile = true;
      }
    }

    if (!options?.skipGapCheck && snapshot.cursor > this.#cursor) {
      const retainedFloor = Math.min(
        activePrompt?.seq ?? Infinity,
        !stale && activeTurn ? (activeTurn.chunks[0]?.seq ?? Infinity) : Infinity,
      );
      if (retainedFloor > this.#cursor + 1) this.#needsReconcile = true;
    }

    if (activeTurn && !stale) this.#replayActiveTurn(activeTurn);

    if (this.#needsReconcile) void this.#reconcileHistory();

    this.#cursor = Math.max(this.#cursor, snapshot.cursor);
    // A prompt still on the wire is invisible to the server, so this phase
    // predates it. Leave the overlay standing while rpcPending; the RPC's
    // own outcome, and the events it triggers, move the spinner from here.
    this.#state.setPhase(snapshot.status.phase);
    if (!this.#state.snapshot.inFlightPrompt?.rpcPending) {
      this.#state.setInFlightPrompt(null);
    }
  }

  #replayActiveTurn(activeTurn: NonNullable<SessionRuntimeSnapshot["activeTurn"]>): void {
    const unseen = activeTurn.chunks.filter((chunkEvent) => chunkEvent.seq > this.#cursor);
    const head = activeTurn.chunks[0];
    const contiguous = head !== undefined && head.seq <= this.#cursor + 1;
    let chunks: UIMessageChunk[];
    if (!activeTurn.truncated || contiguous) {
      chunks = unseen.map((chunkEvent) => chunkEvent.chunk);
    } else if (this.#cursor === 0) {
      chunks = sanitizeTail(unseen.map((chunkEvent) => chunkEvent.chunk));
      this.#recoverTurnIds.add(activeTurn.turnId);
    } else if (activeTurn.complete) {
      void this.#reconcileHistory();
      return;
    } else {
      this.#recoverTurnIds.add(activeTurn.turnId);
      return;
    }
    for (const chunk of chunks) {
      if (chunk.type === "data-retry") continue;
      if (chunk.type === "error") this.#erroredTurnIds.add(activeTurn.turnId);
      this.#turnFold(activeTurn.turnId).enqueue(chunk);
    }
    if (activeTurn.complete) {
      this.#turnFolds.get(activeTurn.turnId)?.close();
      this.#turnFolds.delete(activeTurn.turnId);
      const recovered = this.#recoverTurnIds.delete(activeTurn.turnId);
      const errored = this.#erroredTurnIds.delete(activeTurn.turnId);
      if (recovered || errored) void this.#reconcileHistory();
    }
  }

  // ---------------------------------------------------------------------
  // Shared handlers
  // ---------------------------------------------------------------------

  #observeChunk(chunk: UIMessageChunk): void {
    const retryNotice = retryNoticeFrom(chunk);
    if (retryNotice !== undefined) {
      this.#state.setError(undefined);
      this.#state.setRetryNotice(retryNotice);
      return;
    }
    if (chunk.type === "error") {
      this.#state.setRetryNotice(undefined);
      this.#state.setError(new Error(chunk.errorText));
      return;
    }
    if (this.#state.snapshot.retryNotice !== undefined) this.#state.setRetryNotice(undefined);
  }

  #pushPendingUser(messageId: string, parts: ReadonlyArray<PromptPart>): boolean {
    return this.#state.addPendingUser(toUserMessage(messageId, parts));
  }

  #handleRequest(request: AgentRequest): void {
    if (request.type === "plan" && !request.plan.trim()) {
      void this.#transport
        .respondToAgentRequest(request.id, { type: "plan", behavior: "allow" })
        .catch((error: unknown) => {
          console.error("Failed to auto-approve empty plan request", error);
          this.#state.addPendingRequest(request);
        });
      return;
    }
    this.#state.addPendingRequest(request);
  }

  // Settled is only ever replaced, never merged with live/pending, so this
  // read is safe at any moment — including mid-stream and mid-prompt.
  async #reconcileHistory(): Promise<void> {
    try {
      const history = await this.#transport.getMessages();
      if (this.#state.snapshot.terminated) return;
      this.#state.setHistoryStatus(history === null ? "unavailable" : "settled");
      if (history === null) {
        this.#needsReconcile = false;
        return;
      }
      this.#state.setSettled(Array.from(history), { retainLive: this.#turnFolds.size > 0 });
      this.#needsReconcile = false;
    } catch (reconcileError) {
      console.error("Failed to reconcile session history", reconcileError);
    }
  }

  #turnFold(turnId: string): TurnFold {
    const existing = this.#turnFolds.get(turnId);
    if (existing) return existing;
    let controller: ReadableStreamDefaultController<UIMessageChunk> | undefined;
    const stream = new ReadableStream<UIMessageChunk>({
      start(c) {
        controller = c;
      },
    });
    void (async () => {
      try {
        const seed = { id: `turn-${turnId}`, role: "assistant", parts: [] } as UIMessage;
        for await (const message of readUIMessageStream({ message: seed, stream })) {
          if (this.#state.snapshot.terminated) return;
          this.#state.setLiveAssistant(message as UIMessage);
        }
      } catch (foldError) {
        console.error("Failed to fold turn", foldError);
      }
    })();
    let closed = false;
    const fold: TurnFold = {
      enqueue: (chunk) => {
        if (!closed) controller?.enqueue(chunk);
      },
      close: () => {
        if (closed) return;
        closed = true;
        controller?.close();
      },
    };
    this.#turnFolds.set(turnId, fold);
    return fold;
  }

  // ---------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------

  prompt = async (text: string): Promise<void> => {
    if (this.#state.snapshot.terminated) {
      throw new Error("Session is closed");
    }
    const messageId = generateId();
    const parts: PromptPart[] = [{ type: "text", text }];
    this.#state.setRetryNotice(undefined);
    this.#state.setError(undefined);
    this.#pushPendingUser(messageId, parts);
    this.#state.setInFlightPrompt({ id: messageId, rpcPending: true });
    try {
      await this.#transport.prompt({
        messageId,
        parts,
      });
      if (this.#state.snapshot.inFlightPrompt?.id === messageId) {
        this.#state.setInFlightPrompt({ id: messageId, rpcPending: false });
      }
    } catch (promptError) {
      this.#state.setError(
        promptError instanceof Error ? promptError : new Error(String(promptError)),
      );
      if (this.#state.snapshot.inFlightPrompt?.id === messageId) {
        this.#state.setInFlightPrompt(null);
      }
      throw promptError;
    }
  };

  interrupt = async (): Promise<void> => {
    if (this.#state.snapshot.terminated) {
      throw new Error("Session is closed");
    }
    try {
      await this.#transport.interrupt();
    } catch (interruptError) {
      console.error("Failed to interrupt session", interruptError);
      this.#state.setError(
        interruptError instanceof Error ? interruptError : new Error(String(interruptError)),
      );
    }
  };

  respondToAgentRequest = async (requestId: string, response: AgentResponse): Promise<void> => {
    if (this.#state.snapshot.terminated) {
      throw new Error("Session is closed");
    }
    const request = this.store.getState().pendingRequests.find((r) => r.id === requestId);
    this.#state.removePendingRequest(requestId);
    try {
      await this.#transport.respondToAgentRequest(requestId, response);
    } catch (respondError) {
      console.error("Failed to respond to agent request", respondError);
      if (request) this.#state.addPendingRequest(request);
    }
  };

  dispose = (): void => {
    this.#unsubscribe();
    for (const fold of this.#turnFolds.values()) fold.close();
    this.#turnFolds.clear();
  };
}
