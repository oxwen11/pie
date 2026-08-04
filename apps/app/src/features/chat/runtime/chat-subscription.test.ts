import type { SessionRuntimeSnapshot, SubscribeStreamEvent } from "@vibest/contract";
import { describe, expect, it } from "vitest";

import { RecoveringSubscription } from "./chat-subscription";

const snapshot: SessionRuntimeSnapshot = {
  ref: {
    projectId: "project-1",
    harnessAgentId: "claude-code",
    sessionId: "session-1",
  },
  status: { phase: "idle" },
  activeTurn: null,
  activePrompt: null,
  pendingRequests: [],
  cursor: 0,
};

// Ends immediately: each attach cycle pumps zero events and exits naturally,
// driving the recovery loop around as fast as retryDelayMs allows.
const endingIterable = (): AsyncIterable<SubscribeStreamEvent> => ({
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: true as const, value: undefined }),
  }),
});

// Never yields: the cycle stays parked in the pump until aborted.
const hangingIterable = (): AsyncIterable<SubscribeStreamEvent> => ({
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<never>(() => undefined),
  }),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RecoveringSubscription", () => {
  it("start() is idempotent — a second call opens no second stream", async () => {
    let opens = 0;
    const subscription = new RecoveringSubscription({
      subscribe: async () => {
        opens += 1;
        return hangingIterable();
      },
      getSnapshot: async () => snapshot,
      onEvent: () => undefined,
      retryDelayMs: () => 0,
    });
    subscription.start();
    subscription.start();
    await flush();
    expect(opens).toBe(1);
    subscription.stop();
  });

  it("never overlaps cycles: each stream is closed before the next opens", async () => {
    const timeline: string[] = [];
    const subscription = new RecoveringSubscription({
      subscribe: async (signal) => {
        timeline.push("open");
        signal.addEventListener("abort", () => timeline.push("close"), { once: true });
        return endingIterable();
      },
      getSnapshot: async () => snapshot,
      onEvent: () => undefined,
      retryDelayMs: () => 0,
    });
    subscription.start();
    while (timeline.filter((entry) => entry === "open").length < 3) await flush();
    subscription.stop();

    const reopensWithoutClose = timeline.filter(
      (entry, index) => entry === "open" && index > 0 && timeline[index - 1] !== "close",
    );
    expect(reopensWithoutClose).toEqual([]);
  });
});
