import type { SessionRef, SessionRuntimeSnapshot } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import type { AgentResponse } from "./agent-requests";
import { ChatManager, MAX_LIVE_CHAT_SUBSCRIPTIONS } from "./chat-manager";
import type { ChatSessionTransport, ChatTransportEvent } from "./chat-transport-port";

const refFor = (sessionId: string, overrides: Partial<SessionRef> = {}): SessionRef => ({
  projectId: "project-1",
  sessionId,
  ...overrides,
});

const emptySnapshot = (ref: SessionRef): SessionRuntimeSnapshot => ({
  ref,
  status: { phase: "idle" },
  activeTurn: null,
  activePrompt: null,
  pendingRequests: [],
  cursor: 0,
});

class FakeTransport implements ChatSessionTransport {
  onEvent: ((event: ChatTransportEvent) => void) | null = null;
  disposed = 0;
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  subscribe(onEvent: (event: ChatTransportEvent) => void): () => void {
    this.onEvent = onEvent;
    return () => {
      this.disposed += 1;
    };
  }
  prompt = async () => ({ turnId: "turn-receipt", started: true });
  interrupt = async () => {};
  getMessages = async () => null;
  respondToAgentRequest = async (_requestId: string, _response: AgentResponse) => {};
}

const makeManager = () => {
  const transports: FakeTransport[] = [];
  const manager = new ChatManager((sessionRef) => {
    const transport = new FakeTransport(sessionRef.sessionId);
    transports.push(transport);
    return transport;
  });
  return { manager, transports };
};

const attach = (transport: FakeTransport | undefined, ref: SessionRef) => {
  transport?.onEvent?.({ type: "attached", snapshot: emptySnapshot(ref) });
};

describe("ChatManager", () => {
  it("hands out one Chat per complete SessionRef across calls", () => {
    const { manager, transports } = makeManager();
    const first = manager.chatFor(refFor("session-1"));
    expect(manager.chatFor(refFor("session-1"))).toBe(first);
    expect(manager.chatFor(refFor("session-2"))).not.toBe(first);
    expect(manager.chatFor(refFor("session-1", { projectId: "project-2" }))).not.toBe(first);
    expect(transports).toHaveLength(3);
  });

  it("evicts and unsubscribes a Chat once the session closes", () => {
    const { manager, transports } = makeManager();
    const ref = refFor("session-1");
    const chat = manager.chatFor(ref);
    const transport = transports[0];

    transport?.onEvent?.({ type: "closed", reason: "session_closed" });

    expect(transport?.disposed).toBe(1);
    // The evicted instance keeps its terminal state for whoever is still
    // rendering it — eviction only stops it being handed out again.
    expect(chat.store.getState().error?.message).toBe("Session closed");
  });

  it("builds a fresh Chat when a closed session is opened again", () => {
    const { manager, transports } = makeManager();
    const closed = manager.chatFor(refFor("session-1"));
    transports[0]?.onEvent?.({ type: "closed", reason: "session_closed" });

    // What a restore looks like from here: the terminated instance is gone,
    // so the session gets a new Chat on its own new subscription rather than
    // the permanently-terminated one.
    const reopened = manager.chatFor(refFor("session-1"));
    expect(reopened).not.toBe(closed);
    expect(transports).toHaveLength(2);
    expect(reopened.store.getState().error).toBeUndefined();
  });

  it("evicts once even if the stream closes twice", () => {
    const { manager, transports } = makeManager();
    manager.chatFor(refFor("session-1"));
    const first = transports[0];
    first?.onEvent?.({ type: "closed", reason: "session_closed" });
    const reopened = manager.chatFor(refFor("session-1"));

    // A late duplicate from the dead subscription must not take the
    // replacement down with it.
    first?.onEvent?.({ type: "closed", reason: "session_deleted" });

    expect(manager.chatFor(refFor("session-1"))).toBe(reopened);
    expect(transports[1]?.disposed).toBe(0);
  });

  it("idle-evicts the oldest subscription when the live cap is exceeded", () => {
    const { manager, transports } = makeManager();
    const chats = Array.from({ length: MAX_LIVE_CHAT_SUBSCRIPTIONS + 1 }, (_, index) =>
      manager.chatFor(refFor(`session-${index + 1}`)),
    );

    expect(transports).toHaveLength(MAX_LIVE_CHAT_SUBSCRIPTIONS + 1);
    expect(transports[0]?.disposed).toBe(1);
    expect(chats[0]?.subscribed).toBe(false);
    for (let index = 1; index < chats.length; index += 1) {
      expect(chats[index]?.subscribed).toBe(true);
    }
  });

  it("keeps the store when idle-evicting and re-attaches on return", () => {
    const { manager, transports } = makeManager();
    const ref = refFor("session-1");
    const first = manager.chatFor(ref);
    attach(transports[0], ref);
    first.store.setState({
      messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
    });

    for (let index = 2; index <= MAX_LIVE_CHAT_SUBSCRIPTIONS + 1; index += 1) {
      manager.chatFor(refFor(`session-${index}`));
    }

    expect(transports[0]?.disposed).toBe(1);
    expect(first.subscribed).toBe(false);
    expect(first.store.getState().messages).toHaveLength(1);

    const reopened = manager.chatFor(ref);
    expect(reopened).toBe(first);
    expect(reopened.subscribed).toBe(true);
    expect(transports).toHaveLength(MAX_LIVE_CHAT_SUBSCRIPTIONS + 2);
    expect(transports.at(-1)?.sessionId).toBe("session-1");
    expect(reopened.store.getState().messages).toHaveLength(1);
  });

  it("does not idle-evict the session being re-opened to make room for itself", () => {
    const { manager } = makeManager();
    for (let index = 1; index <= MAX_LIVE_CHAT_SUBSCRIPTIONS; index += 1) {
      manager.chatFor(refFor(`session-${index}`));
    }
    const oldest = manager.chatFor(refFor("session-1"));
    for (let index = 2; index <= MAX_LIVE_CHAT_SUBSCRIPTIONS + 1; index += 1) {
      manager.chatFor(refFor(`session-${index}`));
    }
    expect(oldest.subscribed).toBe(false);

    const reopened = manager.chatFor(refFor("session-1"));
    expect(reopened).toBe(oldest);
    expect(reopened.subscribed).toBe(true);
  });

  it("still shows terminal errors on an archived session after idle eviction", () => {
    const { manager, transports } = makeManager();
    const ref = refFor("session-archived");
    const chat = manager.chatFor(ref);
    attach(transports[0], ref);

    for (let index = 1; index <= MAX_LIVE_CHAT_SUBSCRIPTIONS; index += 1) {
      manager.chatFor(refFor(`session-fill-${index}`));
    }
    expect(chat.subscribed).toBe(false);

    const reopened = manager.chatFor(ref);
    const liveTransport = transports.at(-1);
    liveTransport?.onEvent?.({ type: "closed", reason: "session_deleted" });

    expect(reopened).toBe(chat);
    expect(chat.store.getState().error?.message).toBe("Session deleted");
    expect(liveTransport?.disposed).toBe(1);
  });
});
