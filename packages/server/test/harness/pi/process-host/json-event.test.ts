import { describe, expect, it } from "vitest";

import { toJsonEvent } from "../../../../src/harness/pi/process-host/json-event";

const assistant = {
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "Hi" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "m1",
  usage: {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: 0,
};

describe("toJsonEvent", () => {
  it("passes non-update events through", () => {
    const event = { type: "agent_start" as const };
    expect(toJsonEvent(event)).toBe(event);
  });

  it("drops the cumulative message and partial snapshot from message_update", () => {
    const event = {
      type: "message_update" as const,
      message: assistant,
      assistantMessageEvent: {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: "Hi",
        partial: assistant,
      },
    };
    expect(toJsonEvent(event)).toEqual({
      type: "message_update",
      usage: assistant.usage,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi" },
    });
  });
});
