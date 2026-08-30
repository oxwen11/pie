import type { SessionPhase } from "@getpie/contract";
import type { ChatStatus, UIMessage } from "ai";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { AgentRequest } from "./agent-requests";

// Where the settled-history floor stands. A Chat is born "loading", so an empty
// transcript means "not read yet" rather than "nothing was ever said"; only
// once the floor lands does an empty transcript mean the session really is
// empty. "unavailable" covers both ways the read can come back with nothing to
// lay down — Pi has no history read, or the read failed — which are
// the same fact to a reader: the transcript starts here, the agent's own
// context does not.
export type HistoryStatus = "loading" | "settled" | "unavailable";

// Three sources, composed at write into `messages` (read-only view):
//   settled      — getMessages() only
//   pendingUsers — prompt() / prompt.submitted / snapshot.activePrompt
//   liveAssistant — the current turn fold
// `status` is likewise derived (phase + localSubmitted + terminated). Nothing
// writes either field except #commit.
export type ChatStoreState = {
  settled: UIMessage[];
  pendingUsers: UIMessage[];
  liveAssistant: UIMessage | null;
  messages: UIMessage[];
  phase: SessionPhase;
  // Sender-local overlay: set in prompt(), cleared by a lifecycle phase or a
  // snapshot once the RPC is no longer in flight. Prompt events must not
  // clear it — they carry a pre-turn idle phase.
  localSubmitted: boolean;
  terminated: boolean;
  status: ChatStatus;
  error?: Error;
  retryNotice?: string;
  pendingRequests: AgentRequest[];
  historyStatus: HistoryStatus;
};

export const composeMessages = (s: ChatStoreState): UIMessage[] => {
  const seen = new Set<string>();
  const out: UIMessage[] = [];
  for (const message of s.settled) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    out.push(message);
  }
  for (const message of s.pendingUsers) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    out.push(message);
  }
  if (s.liveAssistant && !seen.has(s.liveAssistant.id)) out.push(s.liveAssistant);
  return out;
};

export const composeStatus = (s: ChatStoreState): ChatStatus => {
  if (s.terminated || s.phase === "crashed") return "error";
  if (s.localSubmitted) return "submitted";
  // liveAssistant can linger one fold-tick after the turn ends idle; phase
  // is the server's word for whether the composer should stay locked.
  if (s.phase === "running" || s.phase === "requires_action") return "streaming";
  return "ready";
};

export const selectMessages = (s: ChatStoreState): UIMessage[] => s.messages;

export const selectChatStatus = (s: ChatStoreState): ChatStatus => s.status;

export const selectTurnInProgress = (s: ChatStoreState): boolean =>
  s.localSubmitted || s.phase === "running" || s.phase === "requires_action";

export const selectCanInterrupt = (s: ChatStoreState): boolean =>
  s.phase === "running" && !s.terminated;

export const selectShowThinking = (s: ChatStoreState): boolean =>
  s.localSubmitted && s.liveAssistant === null;

const initial = (): ChatStoreState => {
  const base: ChatStoreState = {
    settled: [],
    pendingUsers: [],
    liveAssistant: null,
    messages: [],
    phase: "idle",
    localSubmitted: false,
    terminated: false,
    status: "ready",
    error: undefined,
    retryNotice: undefined,
    pendingRequests: [],
    historyStatus: "loading",
  };
  return { ...base, messages: composeMessages(base), status: composeStatus(base) };
};

const idsOf = (messages: readonly UIMessage[]): Set<string> =>
  new Set(messages.map((message) => message.id));

// Chat's state container. Mutators write the three transcript slots and the
// server phase; `messages` / `status` are always recomputed from those.
export class ChatState {
  readonly store: StoreApi<ChatStoreState>;

  constructor() {
    this.store = createStore<ChatStoreState>()(() => initial());
  }

  #commit(
    update: Partial<ChatStoreState> | ((s: ChatStoreState) => Partial<ChatStoreState>),
  ): void {
    this.store.setState((s) => {
      const next = { ...s, ...(typeof update === "function" ? update(s) : update) };
      next.messages = composeMessages(next);
      next.status = composeStatus(next);
      return next;
    });
  }

  get snapshot(): ChatStoreState {
    return this.store.getState();
  }

  // `retainLive` keeps an open fold's assistant when settled is replaced
  // mid-turn. After the fold is gone, omit it so a history replace drops the
  // leftover live slot (history ids and fold ids are not the same).
  setSettled(settled: UIMessage[], options?: { readonly retainLive?: boolean }): void {
    this.#commit((s) => {
      const ids = idsOf(settled);
      const live = s.liveAssistant;
      return {
        settled,
        pendingUsers: s.pendingUsers.filter((message) => !ids.has(message.id)),
        liveAssistant: options?.retainLive && live && !ids.has(live.id) ? live : null,
      };
    });
  }

  // True when the id was not already in settled or pending.
  addPendingUser(message: UIMessage): boolean {
    const s = this.store.getState();
    if (
      s.settled.some((m) => m.id === message.id) ||
      s.pendingUsers.some((m) => m.id === message.id)
    ) {
      return false;
    }
    this.#commit({ pendingUsers: [...s.pendingUsers, message] });
    return true;
  }

  removePendingUser(messageId: string): void {
    this.#commit((s) => ({
      pendingUsers: s.pendingUsers.filter((message) => message.id !== messageId),
    }));
  }

  setLiveAssistant(message: UIMessage | null): void {
    this.#commit({ liveAssistant: message === null ? null : structuredClone(message) });
  }

  // Fold the live assistant into settled so the bubble survives the fold
  // closing, then drop the live slot. A later setSettled replaces this.
  promoteLive(): void {
    this.#commit((s) => {
      if (!s.liveAssistant) return { liveAssistant: null };
      if (s.settled.some((message) => message.id === s.liveAssistant!.id)) {
        return { liveAssistant: null };
      }
      return { settled: [...s.settled, s.liveAssistant], liveAssistant: null };
    });
  }

  setPhase(phase: SessionPhase): void {
    this.#commit({ phase });
  }

  setLocalSubmitted(localSubmitted: boolean): void {
    this.#commit({ localSubmitted });
  }

  setTerminated(): void {
    this.#commit({
      terminated: true,
      localSubmitted: false,
      liveAssistant: null,
      pendingRequests: [],
      retryNotice: undefined,
      historyStatus: "settled",
    });
  }

  setHistoryStatus(historyStatus: HistoryStatus): void {
    this.#commit({ historyStatus });
  }

  setError(error: Error | undefined): void {
    this.#commit({ error });
  }

  setRetryNotice(retryNotice: string | undefined): void {
    this.#commit({ retryNotice });
  }

  setPendingRequests(pendingRequests: AgentRequest[]): void {
    this.#commit({ pendingRequests });
  }

  addPendingRequest(request: AgentRequest): void {
    this.#commit((s) => ({
      pendingRequests: s.pendingRequests.some((r) => r.id === request.id)
        ? s.pendingRequests.map((r) => (r.id === request.id ? request : r))
        : [...s.pendingRequests, request],
    }));
  }

  removePendingRequest(requestId: string): void {
    this.#commit((s) => ({
      pendingRequests: s.pendingRequests.filter((r) => r.id !== requestId),
    }));
  }

  clearPendingRequests(): void {
    this.#commit({ pendingRequests: [] });
  }
}
