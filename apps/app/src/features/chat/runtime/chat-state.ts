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

// Sender-local overlay for one prompt. `rpcPending` is why a snapshot must
// not clear it: the server has not seen the prompt yet. After the RPC
// settles the id stays until a lifecycle phase or a later snapshot.
export type InFlightPrompt = {
  readonly id: string;
  readonly rpcPending: boolean;
};

// Three sources, composed at read:
//   settled      — getMessages() only
//   pendingUsers — prompt() / prompt.submitted / snapshot.activePrompt
//   liveAssistant — the current turn fold
// `messages` / AI-SDK `status` are not stored.
export type ChatStoreState = {
  settled: UIMessage[];
  pendingUsers: UIMessage[];
  liveAssistant: UIMessage | null;
  phase: SessionPhase;
  inFlightPrompt: InFlightPrompt | null;
  terminated: boolean;
  error?: Error;
  retryNotice?: string;
  pendingRequests: AgentRequest[];
  historyStatus: HistoryStatus;
};

export const composeMessages = (
  s: Pick<ChatStoreState, "settled" | "pendingUsers" | "liveAssistant">,
): UIMessage[] => {
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

export const composeStatus = (
  s: Pick<ChatStoreState, "phase" | "inFlightPrompt" | "terminated">,
): ChatStatus => {
  if (s.terminated || s.phase === "crashed") return "error";
  if (s.inFlightPrompt) return "submitted";
  // liveAssistant can linger one fold-tick after the turn ends idle; phase
  // is the server's word for whether the composer should stay locked.
  if (s.phase === "running" || s.phase === "requires_action") return "streaming";
  return "ready";
};

export const selectMessages = composeMessages;

export const selectChatStatus = composeStatus;

export const selectTurnInProgress = (
  s: Pick<ChatStoreState, "phase" | "inFlightPrompt">,
): boolean => s.inFlightPrompt !== null || s.phase === "running" || s.phase === "requires_action";

export const selectCanInterrupt = (s: Pick<ChatStoreState, "phase" | "terminated">): boolean =>
  s.phase === "running" && !s.terminated;

export const selectShowThinking = (
  s: Pick<ChatStoreState, "inFlightPrompt" | "liveAssistant">,
): boolean => s.inFlightPrompt !== null && s.liveAssistant === null;

const initial = (): ChatStoreState => ({
  settled: [],
  pendingUsers: [],
  liveAssistant: null,
  phase: "idle",
  inFlightPrompt: null,
  terminated: false,
  error: undefined,
  retryNotice: undefined,
  pendingRequests: [],
  historyStatus: "loading",
});

const idsOf = (messages: readonly UIMessage[]): Set<string> =>
  new Set(messages.map((message) => message.id));

// Chat's state container. Mutators write the three transcript slots, the
// server phase, and the one in-flight overlay. Views compose at read.
export class ChatState {
  readonly store: StoreApi<ChatStoreState>;

  constructor() {
    this.store = createStore<ChatStoreState>()(() => initial());
  }

  #commit(
    update: Partial<ChatStoreState> | ((s: ChatStoreState) => Partial<ChatStoreState>),
  ): void {
    this.store.setState(update);
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

  setInFlightPrompt(inFlightPrompt: InFlightPrompt | null): void {
    this.#commit({ inFlightPrompt });
  }

  setTerminated(): void {
    this.#commit({
      terminated: true,
      inFlightPrompt: null,
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
