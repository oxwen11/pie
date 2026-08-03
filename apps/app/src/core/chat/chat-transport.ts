import { eventIteratorToStream, ORPCError } from "@orpc/client";
import type { VibestClient } from "@vibest/client";
import type {
  PermissionMode,
  PromptInput,
  PromptPart,
  ReasoningEffort,
  SessionPhase,
  SessionRef,
  SessionRuntimeSnapshot,
  SubscribeStreamEvent,
} from "@vibest/contract";
import { isSessionScopedEvent } from "@vibest/contract";
import type { ChatTransport as AiChatTransport, UIMessage, UIMessageChunk } from "ai";

import type { AgentRequest, AgentResponse } from "./agent-requests";
import type { ChatSessionTransport, SessionChatStatus } from "./chat-transport-port";

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

// Runtime phase → AI-SDK chat status. requires_action keeps "streaming": the
// turn is still open, the composer stays blocked either way.
const statusFromPhase = (phase: SessionPhase): SessionChatStatus =>
  phase === "idle" ? "ready" : phase === "crashed" ? "error" : "streaming";

// Model / permission mode are session config applied via their own calls
// (setModel / setPermissionMode) — a prompt turn never carries them.
const toPromptInput = (ref: SessionRef, message: UIMessage): PromptInput => {
  const parts: PromptPart[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "data-inspector" && Array.isArray(part.data)) {
      parts.push({
        type: "data-inspector",
        data: part.data.filter(
          (target): target is { file: string; line: number; column: number } =>
            typeof target === "object" &&
            target !== null &&
            "file" in target &&
            typeof target.file === "string" &&
            "line" in target &&
            typeof target.line === "number" &&
            "column" in target &&
            typeof target.column === "number",
        ),
      });
    }
  }
  // The optimistic message's own id rides along so `session.prompt.submitted`
  // echoes it and this client can recognise itself in the broadcast.
  return { ref, parts, messageId: message.id };
};

type EventSubscription = {
  readonly events: AsyncIterable<SubscribeStreamEvent>;
  readonly close: () => void;
};

type VibestSessionClient = VibestClient["session"];

type SessionClient = Pick<
  VibestSessionClient,
  | "interrupt"
  | "prompt"
  | "respondToAgentRequest"
  | "setReasoningEffort"
  | "setModel"
  | "setPermissionMode"
  | "getSnapshot"
  | "getMessages"
> & {
  subscribe: (
    ...args: Parameters<VibestSessionClient["subscribe"]>
  ) => Promise<AsyncIterable<SubscribeStreamEvent>>;
};

export type ChatTransportClient = {
  readonly session: SessionClient;
};

type PromptRecovery = {
  readonly subscription: EventSubscription;
  readonly snapshot: SessionRuntimeSnapshot;
};

// The scoped subscription has no replay: a `closed` mid-turn (slow consumer or
// server teardown) is recovered by re-fetching the snapshot — which still
// carries the active turn's buffered chunks — replaying what we haven't seen,
// then re-subscribing. `cursor` is the last session `seq` yielded, so recovery
// never double-emits.
async function* promptChunks(
  initial: EventSubscription,
  turnId: string,
  recover: () => Promise<PromptRecovery>,
  finalize: () => void,
  flagHistoryRecovery: () => void,
): AsyncGenerator<UIMessageChunk> {
  let current = initial;
  let cursor = 0;
  let started = false;
  try {
    while (true) {
      let restarting = false;
      for await (const item of current.events) {
        if (item.type === "closed") {
          const recovery = await recover();
          current.close();
          current = recovery.subscription;
          const activeTurn = recovery.snapshot.activeTurn;
          if (activeTurn?.turnId === turnId) {
            // The snapshot proving our turn exists is what marks it started —
            // its buffer may legitimately still be empty (no chunk yet), and
            // `session.turn.started` will never be redelivered.
            started = true;
            const firstRetained = activeTurn.chunks[0];
            if (activeTurn.truncated && firstRetained !== undefined && cursor < firstRetained.seq) {
              // Chunks between our cursor and the retained tail may have been
              // evicted — replaying across the hole would corrupt the fold.
              // Give up the stream; flagging the gap makes the persistent
              // subscription reconcile from history once the turn ends.
              flagHistoryRecovery();
              return;
            }
            for (const chunkEvent of activeTurn.chunks) {
              if (chunkEvent.seq <= cursor) continue;
              cursor = chunkEvent.seq;
              if (chunkEvent.chunk.type === "error") flagHistoryRecovery();
              yield chunkEvent.chunk;
            }
          }
          cursor = Math.max(cursor, recovery.snapshot.cursor);
          // A newer turn replaced ours, or the session restarted → nothing more
          // for us. A retained buffer marked complete has just been fully
          // replayed → the turn is over.
          if (!activeTurn || activeTurn.turnId !== turnId || activeTurn.complete) return;
          restarting = true;
          break;
        }
        const event = item.event;
        if (!isSessionScopedEvent(event)) continue;
        if (event.seq <= cursor) continue;
        cursor = event.seq;
        switch (event.type) {
          case "session.turn.started":
            if (event.turnId === turnId) started = true;
            continue;
          case "session.message.chunk":
            if (started && event.turnId === turnId) {
              // An error chunk ends this fold, but the harness may retry
              // internally and still complete the turn — the tail then only
              // reaches observers. Flag the turn so the persistent
              // subscription reconciles it from history once it ends.
              if (event.chunk.type === "error") flagHistoryRecovery();
              yield event.chunk;
            }
            continue;
          case "session.turn.ended":
            if (started && event.turnId === turnId) return;
            continue;
          case "session.crashed":
            // Crash always terminates the stream — a crash before our
            // `turn.started` arrived means the turn will never run, and no
            // further event (or `closed`) is coming to end the loop otherwise.
            if (started) flagHistoryRecovery();
            return;
          default:
            continue;
        }
      }
      if (!restarting) return;
    }
  } finally {
    current.close();
    finalize();
  }
}

// One transport per Chat, bound to that session's SessionRef. The ref stays an
// object end to end; nothing here parses it out of a string. AbstractChat's
// `options.chatId` is ignored — this transport already knows its session.
export class OrpcChatSessionTransport implements ChatSessionTransport {
  readonly #ref: SessionRef;
  // Turns this client prompted itself: their chunks fold through the
  // sendMessages stream, so the observer plane must not double-render them.
  readonly #ownTurnIds = new Set<string>();
  // Prompts whose RPC receipt hasn't landed yet, keyed by the optimistic
  // message id. The server stamps that id onto `session.turn.started`, so the
  // persistent subscription can claim the turn as ours during the window
  // where the turn's first events race ahead of the receipt.
  readonly #pendingPromptMessageIds = new Set<string>();
  // Turns that must be recovered from history when they end: a truncated
  // buffer (head chunks dropped), or an own stream that carried an error
  // chunk (the harness may retry internally and finish the turn, with the
  // tail reaching only observers). Shared between the prompt plane and the
  // persistent subscription.
  readonly #recoverTurnIds = new Set<string>();
  // Turns the persistent subscription has already seen end. The two planes
  // race: if the recovery flag lands after the turn ended, the flagger must
  // trigger the reconcile itself.
  readonly #endedTurnIds = new Set<string>();
  // The persistent subscription's reconcile entry point, while attached.
  #reconcile: (() => void) | null = null;

  #flagTurnForRecovery(turnId: string): void {
    this.#recoverTurnIds.add(turnId);
    if (this.#endedTurnIds.has(turnId)) {
      this.#recoverTurnIds.delete(turnId);
      this.#reconcile?.();
    }
  }

  constructor(
    private readonly client: ChatTransportClient,
    sessionRef: SessionRef,
  ) {
    this.#ref = sessionRef;
  }

  async #subscribe(signal: AbortSignal | undefined): Promise<EventSubscription> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    try {
      const events = await this.client.session.subscribe(
        { scope: { kind: "session", ref: this.#ref } },
        { signal: controller.signal },
      );
      return {
        events,
        close: () => {
          signal?.removeEventListener("abort", abort);
          abort();
        },
      };
    } catch (error) {
      signal?.removeEventListener("abort", abort);
      throw error;
    }
  }

  async sendMessages(
    options: Parameters<AiChatTransport<UIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const message = options.messages.at(-1);
    if (!message) throw new Error("message is required");
    // Subscribe before prompting: the live stream has no replay, so the turn's
    // first events must not race ahead of the subscription.
    const initial = await this.#subscribe(options.abortSignal);
    this.#pendingPromptMessageIds.add(message.id);
    try {
      const receipt = await this.client.session
        .prompt(toPromptInput(this.#ref, message), {
          signal: options.abortSignal,
        })
        .catch((error: unknown) => {
          this.#pendingPromptMessageIds.delete(message.id);
          // CONFLICT = another client won the race for this turn. The server
          // status subscription is about to flip the composer to streaming;
          // surface a human explanation instead of the wire code.
          if (error instanceof ORPCError && error.code === "CONFLICT") {
            throw new Error("Another client is already running a turn in this session.");
          }
          throw error;
        });
      this.#pendingPromptMessageIds.delete(message.id);
      this.#ownTurnIds.add(receipt.turnId);
      const interrupt = () => {
        void this.client.session.interrupt({ ref: this.#ref }).catch((error) => {
          if (!isAbortError(error)) console.error("Failed to interrupt session", error);
        });
      };
      options.abortSignal?.addEventListener("abort", interrupt, { once: true });
      const recover = async (): Promise<PromptRecovery> => {
        const subscription = await this.#subscribe(options.abortSignal);
        try {
          const snapshot = await this.client.session.getSnapshot({ ref: this.#ref });
          return { subscription, snapshot };
        } catch (error) {
          subscription.close();
          throw error;
        }
      };
      return eventIteratorToStream(
        promptChunks(
          initial,
          receipt.turnId,
          recover,
          () => options.abortSignal?.removeEventListener("abort", interrupt),
          () => this.#flagTurnForRecovery(receipt.turnId),
        ),
      );
    } catch (error) {
      initial.close();
      throw error;
    }
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null);
  }

  subscribeSessionEvents(handlers: {
    onRequest: (request: AgentRequest) => void;
    onRequestResolved?: (requestId: string) => void;
    onStatus?: (status: SessionChatStatus) => void;
    onHistory?: (messages: ReadonlyArray<UIMessage>) => void;
    onHistoryReconcile?: (messages: ReadonlyArray<UIMessage>) => void;
    onUserMessage?: (message: {
      readonly messageId: string;
      readonly parts: ReadonlyArray<PromptPart>;
    }) => void;
    onTurnChunk?: (turnId: string, chunk: UIMessageChunk) => void;
    onTurnEnded?: (turnId: string) => void;
  }): () => void {
    const onRequest = handlers.onRequest;
    const onRequestResolved = handlers.onRequestResolved ?? (() => undefined);
    const onStatus = handlers.onStatus ?? (() => undefined);
    const onHistory = handlers.onHistory ?? (() => undefined);
    const onHistoryReconcile = handlers.onHistoryReconcile ?? (() => undefined);
    const onUserMessage = handlers.onUserMessage ?? (() => undefined);
    const onTurnChunk = handlers.onTurnChunk ?? (() => undefined);
    const onTurnEnded = handlers.onTurnEnded ?? (() => undefined);
    const observeTurn = (turnId: string) => !this.#ownTurnIds.has(turnId);
    const abortController = new AbortController();
    let current: EventSubscription | undefined;
    const deliveredRequestIds = new Set<string>();
    const resolvedRequestIds = new Set<string>();
    const recoverTurnIds = this.#recoverTurnIds;

    // The live view may have diverged from the settled transcript — re-read
    // history and hand it to the consumer, which decides whether applying is
    // safe. Best-effort: a failed read leaves the pre-reconcile view (a later
    // reload converges).
    const reconcileHistory = async () => {
      try {
        const history = await this.getMessages();
        if (abortController.signal.aborted) return;
        if (history !== null) onHistoryReconcile(history);
      } catch (reconcileError) {
        if (abortController.signal.aborted) return;
        console.error("Failed to reconcile session history", reconcileError);
      }
    };

    const resolveRequest = (requestId: string) => {
      resolvedRequestIds.add(requestId);
      deliveredRequestIds.delete(requestId);
      onRequestResolved(requestId);
    };

    // Synchronous on purpose: the auto-approve call is fire-and-forget, so
    // nothing here is awaited and callers must not serialise on it.
    const handleRequest = (request: AgentRequest) => {
      if (request.type === "plan" && !request.plan.trim()) {
        void this.client.session
          .respondToAgentRequest({
            ref: this.#ref,
            requestId: request.id,
            response: { type: "plan", behavior: "allow" },
          })
          .catch((error) => {
            if (abortController.signal.aborted || resolvedRequestIds.has(request.id)) return;
            console.error("Failed to auto-approve empty plan request", error);
            deliveredRequestIds.add(request.id);
            onRequest(request);
          });
        return;
      }
      resolvedRequestIds.delete(request.id);
      deliveredRequestIds.add(request.id);
      onRequest(request);
    };

    const hydratePendingRequests = async (sinceCursor: number) => {
      const snapshot = await this.client.session.getSnapshot({ ref: this.#ref });
      const pendingRequestIds = new Set(snapshot.pendingRequests.map((request) => request.id));
      for (const requestId of deliveredRequestIds) {
        if (!pendingRequestIds.has(requestId)) resolveRequest(requestId);
      }
      for (const request of snapshot.pendingRequests) handleRequest(request);
      // The snapshot is the status ground truth at (re)attach — a turn another
      // client is running right now surfaces here, not via a replayed
      // turn.started (which is never re-sent). Its retained buffer is also the
      // only recovery for observed-turn chunks missed while detached. On first
      // attach (cursor 0) a buffer marked complete is history, not recovery —
      // replaying it would float a lone stale reply above the transcript.
      const activeTurn = snapshot.activeTurn;
      const staleAtFirstAttach = sinceCursor === 0 && activeTurn?.complete === true;
      // The retained prompt is the only recovery for a `prompt.submitted`
      // missed while detached (it is never re-sent). Seq-gated so a live
      // delivery is never repeated; at a stale first attach it is settled
      // history and the history read covers it. Delivered before the chunk
      // replay so the user bubble lands above the streaming reply.
      const activePrompt = snapshot.activePrompt;
      if (activePrompt && activePrompt.seq > sinceCursor && !staleAtFirstAttach) {
        onUserMessage({ messageId: activePrompt.messageId, parts: activePrompt.parts });
      }
      if (activeTurn?.truncated === true && !staleAtFirstAttach) {
        // The buffer lost its head — no fold can rebuild the message from it,
        // whoever owns the turn. Skip its chunks (buffered and live) and
        // recover it from history at its end; a retained complete buffer
        // already ended, so reconcile immediately.
        recoverTurnIds.add(activeTurn.turnId);
        if (activeTurn.complete) void reconcileHistory();
      } else if (activeTurn && !staleAtFirstAttach && observeTurn(activeTurn.turnId)) {
        for (const chunkEvent of activeTurn.chunks) {
          if (chunkEvent.seq <= sinceCursor) continue;
          onTurnChunk(activeTurn.turnId, chunkEvent.chunk);
        }
        if (activeTurn.complete) onTurnEnded(activeTurn.turnId);
      }
      onStatus(statusFromPhase(snapshot.status.phase));
      return Math.max(sinceCursor, snapshot.cursor);
    };

    this.#reconcile = () => void reconcileHistory();
    const run = async () => {
      current = await this.#subscribe(abortController.signal);
      // Settled history first, after subscribing (so nothing races past us)
      // but before any replay — the transcript floor must be down before the
      // active prompt and chunk replay land on top. Best-effort: a failed read
      // degrades to the pre-history behaviour (live turn only).
      try {
        const history = await this.getMessages();
        // Disposed while the read was in flight — don't deliver into a dead
        // handler set (the RPC itself carries no abort signal).
        if (abortController.signal.aborted) return;
        if (history !== null && history.length > 0) onHistory(history);
      } catch (historyError) {
        if (abortController.signal.aborted) return;
        console.error("Failed to load session history", historyError);
      }
      let cursor: number;
      try {
        cursor = await hydratePendingRequests(0);
      } catch (error) {
        current.close();
        throw error;
      }
      while (!abortController.signal.aborted) {
        let restarting = false;
        for await (const item of current.events) {
          if (item.type === "closed") {
            const replacement = await this.#subscribe(abortController.signal);
            try {
              cursor = await hydratePendingRequests(cursor);
            } catch (error) {
              replacement.close();
              throw error;
            }
            current.close();
            current = replacement;
            restarting = true;
            break;
          }
          const event = item.event;
          if (!isSessionScopedEvent(event)) continue;
          if (event.seq <= cursor) continue;
          cursor = event.seq;
          switch (event.type) {
            case "session.request.asked":
              handleRequest(event.request);
              break;
            case "session.request.replied":
            case "session.request.rejected":
              resolveRequest(event.requestId);
              break;
            case "session.prompt.submitted":
              onUserMessage({ messageId: event.messageId, parts: event.parts });
              break;
            case "session.message.chunk":
              if (observeTurn(event.turnId) && !recoverTurnIds.has(event.turnId)) {
                onTurnChunk(event.turnId, event.chunk);
              }
              break;
            // Status transitions ride the same cursor-gated loop, so a stale
            // turn event can never overwrite a fresher hydrate.
            case "session.turn.started":
              // A turn linked to a prompt we sent but whose receipt is still
              // in flight is ours — claim it before its chunks arrive, or the
              // observer plane would double-render them.
              if (
                event.messageId !== undefined &&
                this.#pendingPromptMessageIds.has(event.messageId)
              )
                this.#ownTurnIds.add(event.turnId);
              onStatus("streaming");
              break;
            case "session.turn.ended": {
              if (observeTurn(event.turnId) && !recoverTurnIds.has(event.turnId)) {
                onTurnEnded(event.turnId);
              }
              onStatus("ready");
              // The settled transcript may hold more than the live stream
              // carried: a non-completed turn can have persisted partial (or,
              // pi, internally-retried full) output, and a truncated turn was
              // never rendered live at all. Re-read and let the consumer
              // decide whether applying is safe.
              this.#endedTurnIds.add(event.turnId);
              if (event.outcome !== "completed" || recoverTurnIds.has(event.turnId)) {
                recoverTurnIds.delete(event.turnId);
                void reconcileHistory();
              }
              break;
            }
            case "session.crashed":
              onStatus("error");
              break;
            default:
              break;
          }
        }
        if (!restarting) return;
      }
    };

    void run().catch((streamError) => {
      if (!isAbortError(streamError)) console.error("Session events stream error:", streamError);
    });

    return () => {
      this.#reconcile = null;
      abortController.abort();
      current?.close();
    };
  }

  // NOT_FOUND here is "the request is no longer pending" — with several
  // clients on one session, that usually means another client answered first.
  // The outcome the responder wanted (request resolved) holds either way, so
  // it maps to success; the request.replied event closes the card everywhere.
  async respondToAgentRequest(requestId: string, response: AgentResponse): Promise<void> {
    try {
      await this.client.session.respondToAgentRequest({
        ref: this.#ref,
        requestId,
        response,
      });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") return;
      throw error;
    }
  }

  async setModel(providerId: string, modelId: string): Promise<void> {
    await this.client.session.setModel({ ref: this.#ref, providerId, modelId });
  }

  async setReasoningEffort(reasoningEffort: ReasoningEffort): Promise<void> {
    await this.client.session.setReasoningEffort({ ref: this.#ref, reasoningEffort });
  }

  async setPermissionMode(permissionMode: PermissionMode): Promise<void> {
    await this.client.session.setPermissionMode({ ref: this.#ref, permissionMode });
  }

  // UNSUPPORTED is the server saying "this harness serves no history" — a
  // capability fact, not a failure; it maps to `null` so the oRPC error
  // vocabulary stays on this side of the port.
  async getMessages(): Promise<readonly UIMessage[] | null> {
    try {
      const result = await this.client.session.getMessages({ ref: this.#ref });
      return result.messages;
    } catch (error) {
      if (error instanceof ORPCError && error.code === "UNSUPPORTED") return null;
      throw error;
    }
  }
}
