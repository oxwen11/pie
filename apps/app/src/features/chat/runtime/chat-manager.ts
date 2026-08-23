import type { SessionRef } from "@getpie/contract";

import { sessionRefKey } from "@/lib/session-ref";

import { Chat } from "./chat";
import type { ChatSessionTransportFactory } from "./chat-transport-port";

/** Max concurrent per-session subscribe streams ChatManager keeps alive. */
export const MAX_LIVE_CHAT_SUBSCRIPTIONS = 8;

// The narrow surface features are allowed to touch. Orchestration internals
// (the session map, disposal) stay on the class.
export interface ChatManagerApi {
  chatFor(sessionRef: SessionRef): Chat;
}

// Owns the live Chat instances keyed by the complete SessionRef. Sessions survive
// route switches: chatFor() is get-or-create, and nothing disposes a Chat on
// navigation — its store keeps the transcript for the next mount. Two kinds of
// eviction: idle LRU below drops only the transport while the Chat and store
// stay cached; terminal eviction on `closed` removes the entry entirely. Each
// Chat gets its own transport, minted from the injected factory and bound to
// its SessionRef; the manager knows nothing about oRPC or the wire client.
// Constructed once when the shared App mounts, not at module scope: a
// module-level `new` cannot see the host connection the entry supplied.
export class ChatManager implements ChatManagerApi {
  #chats = new Map<string, Chat>();
  // Access order for idle LRU: oldest key first, most recently used last.
  #accessOrder = new Map<string, Chat>();
  #subscribed = new Set<string>();

  constructor(private readonly createTransport: ChatSessionTransportFactory) {}

  // chatFor is get-or-create per SessionRef; later calls return the existing
  // Chat for that ref. A cached Chat whose transport was idle-evicted
  // re-subscribes here via the existing snapshot attach path.
  chatFor(sessionRef: SessionRef): Chat {
    const key = sessionRefKey(sessionRef);
    const existing = this.#chats.get(key);
    if (existing) {
      this.#touch(key, existing);
      this.#ensureSubscribed(key, sessionRef, existing);
      return existing;
    }

    this.#evictIdleSubscriptions();
    const chat = new Chat({
      sessionRef,
      transport: this.createTransport(sessionRef),
      onTerminated: () => this.#evictTerminated(key),
    });
    this.#chats.set(key, chat);
    this.#subscribed.add(key);
    this.#touch(key, chat);
    return chat;
  }

  #ensureSubscribed(key: string, sessionRef: SessionRef, chat: Chat): void {
    if (this.#subscribed.has(key)) return;
    this.#evictIdleSubscriptions(key);
    chat.reattach(this.createTransport(sessionRef));
    this.#subscribed.add(key);
  }

  // Drop the oldest idle subscription(s) until under the cap. The exempt key
  // is the session about to (re)subscribe — never evict the caller's own slot.
  #evictIdleSubscriptions(exemptKey?: string): void {
    while (this.#subscribed.size >= MAX_LIVE_CHAT_SUBSCRIPTIONS) {
      const victimKey = this.#oldestSubscribedKey(exemptKey);
      if (!victimKey) break;
      const chat = this.#chats.get(victimKey);
      if (!chat) {
        this.#subscribed.delete(victimKey);
        continue;
      }
      chat.dispose();
      this.#subscribed.delete(victimKey);
    }
  }

  #oldestSubscribedKey(exemptKey?: string): string | undefined {
    for (const key of this.#accessOrder.keys()) {
      if (key === exemptKey) continue;
      if (this.#subscribed.has(key)) return key;
    }
    return undefined;
  }

  #touch(key: string, chat: Chat): void {
    this.#accessOrder.delete(key);
    this.#accessOrder.set(key, chat);
  }

  // The server declared the stream over (archived, deleted — the Chat doesn't
  // distinguish, and neither does this). Drop the cache entry and release the
  // subscription; the store itself is left alone, because whoever is rendering
  // this session right now still holds the instance and needs its terminal
  // error on screen. That view keeps working, the transcript is collected once
  // it unmounts, and a session restored later gets a Chat built from scratch —
  // which is also what un-sticks `#terminated`, a flag nothing ever clears.
  //
  // Safe to look the entry up rather than compare identities: `closed` reaches
  // a Chat only from inside the subscription's async loop, so the `set` below
  // has always run by the time this fires.
  #evictTerminated(key: string): void {
    const chat = this.#chats.get(key);
    if (!chat) return;
    this.#chats.delete(key);
    this.#accessOrder.delete(key);
    this.#subscribed.delete(key);
    chat.dispose();
  }
}
