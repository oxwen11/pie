import { describe, expect, it } from "vitest";

import { makeChat } from "./chat-test-helpers";

describe("Chat pending prompt", () => {
  it("sends a follow-up while streaming without a transcript bubble or local queue write", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    await chat.prompt("hello there");
    live(1, {
      type: "session.prompt.submitted",
      messageId: transport.promptCalls[0]!.messageId,
      parts: [{ type: "text", text: "hello there" }],
      phase: "idle",
    });
    live(2, { type: "session.turn.started", turnId: "turn-1", phase: "running" });

    await chat.prompt("and then this");
    expect(transport.promptCalls[1]).toMatchObject({
      parts: [{ type: "text", text: "and then this" }],
      delivery: "followUp",
    });
    expect(chat.store.getState().messages).toHaveLength(1);
    expect(chat.store.getState().pendingPrompt.followUp).toEqual([]);
    expect(chat.store.getState().status).toBe("streaming");
  });

  it("sends a steer while streaming when the caller asks for that delivery", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    await chat.prompt("hello there");
    live(1, {
      type: "session.prompt.submitted",
      messageId: transport.promptCalls[0]!.messageId,
      parts: [{ type: "text", text: "hello there" }],
      phase: "idle",
    });
    live(2, { type: "session.turn.started", turnId: "turn-1", phase: "running" });

    await chat.prompt("do this instead", "steer");
    expect(transport.promptCalls[1]).toMatchObject({
      parts: [{ type: "text", text: "do this instead" }],
      delivery: "steer",
    });
    expect(chat.store.getState().messages).toHaveLength(1);
    expect(chat.store.getState().pendingPrompt.steering).toEqual([]);
  });

  it("replaces the pending prompt from session.queue.updated", async () => {
    const { chat, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.queue.updated",
      steering: ["steer me"],
      followUp: ["later"],
      phase: "running",
    });
    expect(chat.store.getState().pendingPrompt).toEqual({
      steering: ["steer me"],
      followUp: ["later"],
    });
  });

  it("hydrates the pending prompt from a snapshot", async () => {
    const { chat, attach } = makeChat();
    await attach({
      pendingPrompt: { steering: [], followUp: ["held"] },
      status: { phase: "running" },
      cursor: 4,
    });
    expect(chat.store.getState().pendingPrompt.followUp).toEqual(["held"]);
  });

  it("keeps the queue empty when a follow-up races to a real prompt", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    await chat.prompt("hello there");
    live(1, {
      type: "session.prompt.submitted",
      messageId: transport.promptCalls[0]!.messageId,
      parts: [{ type: "text", text: "hello there" }],
      phase: "idle",
    });
    live(2, { type: "session.turn.started", turnId: "turn-1", phase: "running" });
    await chat.prompt("and then this");
    live(3, {
      type: "session.prompt.submitted",
      messageId: transport.promptCalls[1]!.messageId,
      parts: [{ type: "text", text: "and then this" }],
      phase: "running",
    });
    expect(chat.store.getState().messages).toHaveLength(2);
    expect(chat.store.getState().pendingPrompt.followUp).toEqual([]);
  });

  it("applies a follow-up to the pending prompt only after session.queue.updated", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    await chat.prompt("hello there");
    live(1, {
      type: "session.prompt.submitted",
      messageId: transport.promptCalls[0]!.messageId,
      parts: [{ type: "text", text: "hello there" }],
      phase: "idle",
    });
    live(2, { type: "session.turn.started", turnId: "turn-1", phase: "running" });
    await chat.prompt("and then this");
    expect(chat.store.getState().pendingPrompt.followUp).toEqual([]);
    live(3, {
      type: "session.queue.updated",
      steering: [],
      followUp: ["and then this"],
      phase: "running",
    });
    expect(chat.store.getState().pendingPrompt.followUp).toEqual(["and then this"]);
  });

  it("clears the pending prompt when the session crashes", async () => {
    const { chat, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.queue.updated",
      steering: [],
      followUp: ["later"],
      phase: "running",
    });
    live(2, { type: "session.crashed", reason: "boom", phase: "crashed" });
    expect(chat.store.getState().pendingPrompt).toEqual({ steering: [], followUp: [] });
  });

  it("optimistically replaces the pending prompt", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.queue.updated",
      steering: ["steer me"],
      followUp: ["later"],
      phase: "running",
    });

    await chat.replaceQueue({ steering: ["steer me"], followUp: ["edited"] });

    expect(transport.replaceQueueCalls).toEqual([{ steering: ["steer me"], followUp: ["edited"] }]);
    expect(chat.store.getState().pendingPrompt).toEqual({
      steering: ["steer me"],
      followUp: ["edited"],
    });
    expect(chat.store.getState().status).toBe("ready");
  });

  it("rolls back the pending prompt when replaceQueue fails", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.queue.updated",
      steering: [],
      followUp: ["later"],
      phase: "running",
    });
    transport.replaceQueueError = new Error("rewrite failed");

    await expect(chat.replaceQueue({ steering: [], followUp: [] })).rejects.toThrow(
      "rewrite failed",
    );

    expect(chat.store.getState().pendingPrompt).toEqual({ steering: [], followUp: ["later"] });
    expect(chat.store.getState().status).toBe("ready");
    expect(chat.store.getState().error).toBeUndefined();
  });

  it("ignores queue_update while replaceQueue is in flight", async () => {
    const { chat, transport, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.queue.updated",
      steering: [],
      followUp: ["later"],
      phase: "running",
    });
    let release: () => void = () => undefined;
    transport.replaceQueueGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = chat.replaceQueue({ steering: [], followUp: ["kept"] });
    live(2, {
      type: "session.queue.updated",
      steering: [],
      followUp: [],
      phase: "running",
    });
    expect(chat.store.getState().pendingPrompt.followUp).toEqual(["kept"]);
    release();
    await pending;
    expect(chat.store.getState().pendingPrompt.followUp).toEqual(["kept"]);
  });
});
