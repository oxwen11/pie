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
    });
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "live"]);
  });

  it("drops pending and live ids already present in settled", () => {
    const u2 = user("u2");
    const messages = composeMessages({
      settled: [user("u1"), u2],
      pendingUsers: [u2],
      liveAssistant: assistant("u2"),
    });
    expect(messages.map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});

describe("composeStatus", () => {
  const base = {
    phase: "idle" as const,
    inFlightPrompt: null,
    terminated: false,
  };

  it("keeps submitted while a leftover live assistant sits on an idle phase", () => {
    expect(
      composeStatus({
        ...base,
        inFlightPrompt: { id: "p", rpcPending: false },
      }),
    ).toBe("submitted");
    expect(composeStatus({ ...base })).toBe("ready");
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
    expect(composeMessages(state.snapshot).map((m) => m.id)).toEqual(["h1", "u1"]);

    state.setLiveAssistant(assistant("live"));
    state.setSettled([user("h1")], { retainLive: true });
    expect(state.snapshot.liveAssistant?.id).toBe("live");
    expect(composeMessages(state.snapshot).map((m) => m.id)).toEqual(["h1", "u1", "live"]);
  });
});
