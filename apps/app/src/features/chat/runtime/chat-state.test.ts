import { describe, expect, it } from "vitest";

import { ChatState, composeMessages, composeStatus } from "./chat-state";

const user = (id: string) => ({
  id,
  role: "user" as const,
  parts: [{ type: "text" as const, text: id }],
});

const assistant = (id: string) => ({
  id,
  role: "assistant" as const,
  parts: [{ type: "text" as const, text: id }],
});

describe("composeMessages", () => {
  it("lays pending users between settled history and the live assistant", () => {
    const messages = composeMessages({
      settled: [user("u1"), assistant("a1")],
      pendingUsers: [user("u2")],
      liveAssistant: assistant("live"),
      messages: [],
      phase: "running",
      localSubmitted: false,
      terminated: false,
      status: "streaming",
      pendingRequests: [],
      historyStatus: "settled",
    });
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "live"]);
  });

  it("drops pending and live ids already present in settled", () => {
    const u2 = user("u2");
    const messages = composeMessages({
      settled: [user("u1"), u2],
      pendingUsers: [u2],
      liveAssistant: assistant("u2"),
      messages: [],
      phase: "idle",
      localSubmitted: false,
      terminated: false,
      status: "ready",
      pendingRequests: [],
      historyStatus: "settled",
    });
    expect(messages.map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});

describe("composeStatus", () => {
  const base = {
    settled: [] as const,
    pendingUsers: [] as const,
    liveAssistant: null,
    messages: [] as const,
    phase: "idle" as const,
    localSubmitted: false,
    terminated: false,
    status: "ready" as const,
    pendingRequests: [] as const,
    historyStatus: "settled" as const,
  };

  it("keeps submitted while a leftover live assistant sits on an idle phase", () => {
    expect(composeStatus({ ...base, localSubmitted: true, liveAssistant: assistant("a") })).toBe(
      "submitted",
    );
    expect(composeStatus({ ...base, liveAssistant: assistant("a") })).toBe("ready");
  });

  it("maps requires_action to streaming and crashed/terminated to error", () => {
    expect(composeStatus({ ...base, phase: "requires_action" })).toBe("streaming");
    expect(composeStatus({ ...base, phase: "crashed" })).toBe("error");
    expect(composeStatus({ ...base, terminated: true })).toBe("error");
  });
});

describe("ChatState.setSettled", () => {
  it("clears a leftover live slot unless retainLive is set", () => {
    const state = new ChatState();
    state.addPendingUser(user("u1"));
    state.setLiveAssistant(assistant("live"));
    state.setSettled([user("h1")]);
    expect(state.snapshot.liveAssistant).toBeNull();
    expect(state.snapshot.pendingUsers.map((m) => m.id)).toEqual(["u1"]);
    expect(state.snapshot.messages.map((m) => m.id)).toEqual(["h1", "u1"]);

    state.setLiveAssistant(assistant("live"));
    state.setSettled([user("h1")], { retainLive: true });
    expect(state.snapshot.liveAssistant?.id).toBe("live");
    expect(state.snapshot.messages.map((m) => m.id)).toEqual(["h1", "u1", "live"]);
  });
});
