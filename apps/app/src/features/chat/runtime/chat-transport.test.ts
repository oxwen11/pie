import { ORPCError } from "@orpc/client";
import type { AgentRequest, SessionRuntimeSnapshot, SubscribeStreamEvent } from "@vibest/contract";
import type { UIMessage, UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import { OrpcChatSessionTransport, type ChatTransportClient } from "./chat-transport";

const ref = {
  projectId: "project-1",
  harnessAgentId: "claude-code",
  sessionId: "session-1",
} as const;

const pendingRequest: AgentRequest = {
  type: "tool",
  id: "request-1",
  harnessAgentId: "claude-code",
  toolName: "Bash",
  input: { command: "pwd" },
  actions: [{ id: "allow", label: "Allow", behavior: "allow" }],
  native: null,
};

const snapshot: SessionRuntimeSnapshot = {
  ref,
  status: { phase: "requires_action" },
  activeTurn: null,
  activePrompt: null,
  pendingRequests: [pendingRequest],
  cursor: 7,
};

// Serves no history: what every harness without a native read looks like
// through the port (UNSUPPORTED → null → no onHistory delivery).
const noHistory = async (): Promise<never> => {
  throw new ORPCError("UNSUPPORTED");
};

const emptyPlanRequest: AgentRequest = {
  type: "plan",
  id: "empty-plan",
  harnessAgentId: "claude-code",
  plan: "",
  native: null,
};

const asyncIterableOf = (
  items: readonly SubscribeStreamEvent[],
  onDone: () => void = () => undefined,
): AsyncIterable<SubscribeStreamEvent> => ({
  [Symbol.asyncIterator]() {
    let index = 0;
    return {
      next: async () => {
        const item = items[index];
        index += 1;
        if (item) return { done: false as const, value: item };
        onDone();
        return { done: true as const, value: undefined };
      },
    };
  },
});

const unexpectedCall = async (): Promise<never> => {
  throw new Error("Unexpected transport call");
};

describe("OrpcChatSessionTransport agent requests", () => {
  it("hydrates pending requests from the initial session snapshot", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let subscriptionCalls = 0;
    let snapshotCalls = 0;
    let snapshotSawSubscription = false;
    const items: SubscribeStreamEvent[] = [
      {
        type: "event",
        event: { seq: 7, ref, type: "session.request.asked", request: pendingRequest },
      },
      {
        type: "event",
        event: { seq: 8, ref, type: "session.request.replied", requestId: pendingRequest.id },
      },
    ];
    const session = {
      getSnapshot: async () => {
        snapshotCalls += 1;
        snapshotSawSubscription = subscriptionCalls === 1;
        return snapshot;
      },
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscriptionCalls += 1;
        // Resolve the test once the stream is fully drained.
        return asyncIterableOf(items, finishStream);
      },
    };
    const client = { session } satisfies ChatTransportClient;
    let deliveries = 0;
    const received: AgentRequest[] = [];
    const transport = new OrpcChatSessionTransport(client, ref);

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: (request) => {
        deliveries += 1;
        received.push(request);
      },
      onRequestResolved: (requestId) => {
        const index = received.findIndex((request) => request.id === requestId);
        if (index >= 0) received.splice(index, 1);
      },
    });
    await streamDone;
    // Allow the drained stream's request handling to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(subscriptionCalls).toBe(1);
    expect(snapshotCalls).toBe(1);
    expect(snapshotSawSubscription).toBe(true);
    expect(deliveries).toBe(1);
    expect(received).toEqual([]);
  });

  it("keeps listening when a resolved empty plan rejects its automatic response", async () => {
    let rejectAutomaticResponse: (error: Error) => void = () => undefined;
    const automaticResponse = new Promise<never>((_resolve, reject) => {
      rejectAutomaticResponse = reject;
    });
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const items: SubscribeStreamEvent[] = [
      {
        type: "event",
        event: { seq: 8, ref, type: "session.request.replied", requestId: emptyPlanRequest.id },
      },
      {
        type: "event",
        event: { seq: 9, ref, type: "session.request.asked", request: pendingRequest },
      },
    ];
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ...snapshot,
        pendingRequests: [emptyPlanRequest],
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: async () => automaticResponse,
      subscribe: async () => asyncIterableOf(items, finishStream),
    };
    const client = { session } satisfies ChatTransportClient;
    const received: AgentRequest[] = [];
    const transport = new OrpcChatSessionTransport(client, ref);

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: (request) => received.push(request),
      onRequestResolved: (requestId) => {
        const index = received.findIndex((request) => request.id === requestId);
        if (index >= 0) received.splice(index, 1);
      },
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectAutomaticResponse(new Error("request already resolved"));
    await Promise.resolve();
    unsubscribe();

    expect(received).toEqual([pendingRequest]);
  });

  it("hydrates status from the snapshot and follows turn events", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const items: SubscribeStreamEvent[] = [
      { type: "event", event: { seq: 8, ref, type: "session.turn.started", turnId: "turn-2" } },
      {
        type: "event",
        event: { seq: 9, ref, type: "session.turn.ended", turnId: "turn-2", outcome: "completed" },
      },
    ];
    const session = {
      // Another client is mid-turn at attach time: hydrate must report it —
      // its `session.turn.started` will never be redelivered.
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-1" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-1",
          messageId: null,
          chunks: [],
          complete: false,
          truncated: false,
        },
        activePrompt: null,
        cursor: 7,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf(items, finishStream),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const statuses: string[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(statuses).toEqual(["streaming", "streaming", "ready"]);
  });

  it("replays the snapshot's observed-turn buffer, then follows live prompts and chunks", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const items: SubscribeStreamEvent[] = [
      {
        type: "event",
        event: {
          seq: 8,
          ref,
          type: "session.prompt.submitted",
          messageId: "msg-1",
          parts: [{ type: "text", text: "from another client" }],
        },
      },
      {
        type: "event",
        event: {
          seq: 9,
          ref,
          type: "session.message.chunk",
          turnId: "turn-9",
          chunk: { type: "text-delta", id: "b1", delta: "live" },
        },
      },
      {
        type: "event",
        event: { seq: 10, ref, type: "session.turn.ended", turnId: "turn-9", outcome: "completed" },
      },
    ];
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-9" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-9",
          messageId: "m9",
          chunks: [
            {
              seq: 5,
              ref,
              type: "session.message.chunk",
              turnId: "turn-9",
              chunk: { type: "text-delta", id: "b1", delta: "buffered-1" },
            },
            {
              seq: 6,
              ref,
              type: "session.message.chunk",
              turnId: "turn-9",
              chunk: { type: "text-delta", id: "b1", delta: "buffered-2" },
            },
          ],
          complete: false,
          truncated: false,
        },
        activePrompt: null,
        cursor: 6,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf(items, finishStream),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const userMessages: string[] = [];
    const chunks: string[] = [];
    const endedTurns: string[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onUserMessage: ({ messageId }) => userMessages.push(messageId),
      onTurnChunk: (turnId, chunk) =>
        chunks.push(`${turnId}:${(chunk as { delta?: string }).delta ?? chunk.type}`),
      onTurnEnded: (turnId) => endedTurns.push(turnId),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(userMessages).toEqual(["msg-1"]);
    expect(chunks).toEqual(["turn-9:buffered-1", "turn-9:buffered-2", "turn-9:live"]);
    expect(endedTurns).toEqual(["turn-9"]);
  });

  it("skips a completed retained buffer on first attach instead of replaying stale history", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "idle" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-old",
          messageId: "m-old",
          chunks: [
            {
              seq: 5,
              ref,
              type: "session.message.chunk",
              turnId: "turn-old",
              chunk: { type: "text-delta", id: "b1", delta: "stale" },
            },
          ],
          complete: true,
          truncated: false,
        },
        activePrompt: { messageId: "p-old", parts: [{ type: "text", text: "old ask" }], seq: 4 },
        cursor: 6,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf([], finishStream),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const chunks: string[] = [];
    const endedTurns: string[] = [];
    const statuses: string[] = [];
    const userMessages: string[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onStatus: (status) => statuses.push(status),
      onUserMessage: ({ messageId }) => userMessages.push(messageId),
      onTurnChunk: (turnId, chunk) =>
        chunks.push(`${turnId}:${(chunk as { delta?: string }).delta ?? chunk.type}`),
      onTurnEnded: (turnId) => endedTurns.push(turnId),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(chunks).toEqual([]);
    expect(endedTurns).toEqual([]);
    // The retained prompt is settled history at a stale first attach — the
    // history read covers it, so it must not replay either.
    expect(userMessages).toEqual([]);
    expect(statuses).toEqual(["ready"]);
  });

  it("delivers history before the retained prompt and buffered chunks at first attach", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const history: UIMessage[] = [
      { id: "h-user", role: "user", parts: [{ type: "text", text: "earlier ask" }] },
      { id: "h-assistant", role: "assistant", parts: [{ type: "text", text: "earlier reply" }] },
    ];
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-9" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-9",
          messageId: "m9",
          chunks: [
            {
              seq: 6,
              ref,
              type: "session.message.chunk",
              turnId: "turn-9",
              chunk: { type: "text-delta", id: "b1", delta: "buffered" },
            },
          ],
          complete: false,
          truncated: false,
        },
        activePrompt: { messageId: "p-live", parts: [{ type: "text", text: "live ask" }], seq: 4 },
        cursor: 6,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: async () => ({ messages: history }),
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf([], finishStream),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const deliveries: string[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onHistory: (messages) => deliveries.push(`history:${messages.length}`),
      onUserMessage: ({ messageId }) => deliveries.push(`user:${messageId}`),
      onTurnChunk: (turnId, chunk) =>
        deliveries.push(`chunk:${(chunk as { delta?: string }).delta ?? chunk.type}`),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    // Floor first, then the running turn's user message, then its chunks — the
    // order the transcript needs to compose without stitching.
    expect(deliveries).toEqual(["history:2", "user:p-live", "chunk:buffered"]);
  });

  it("does not replay the retained prompt again after a mid-stream reattach", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let subscribeCalls = 0;
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-9" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-9",
          messageId: null,
          chunks: [],
          complete: false,
          truncated: false,
        },
        activePrompt: { messageId: "p-live", parts: [{ type: "text", text: "live ask" }], seq: 4 },
        cursor: 6,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscribeCalls += 1;
        // First subscription drops immediately; the replacement drains empty.
        if (subscribeCalls === 1) {
          return asyncIterableOf([{ type: "closed", reason: "stream_replaced" }]);
        }
        return asyncIterableOf([], finishStream);
      },
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const userMessages: string[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onUserMessage: ({ messageId }) => userMessages.push(messageId),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    // First hydrate (cursor 0) delivers it; the reattach hydrate starts from
    // cursor 6 and the prompt's seq 4 is behind it — seq-gated out.
    expect(subscribeCalls).toBe(2);
    expect(userMessages).toEqual(["p-live"]);
  });

  it("claims a turn linked to an in-flight prompt before its receipt lands", async () => {
    // The observer plane sees `session.turn.started` carrying the optimistic
    // message id while the prompt RPC's receipt is still in flight: the turn is
    // ours, so its chunks must not double-render through the observer path.
    let promptCalled: () => void = () => undefined;
    const promptCalledOnce = new Promise<void>((resolve) => {
      promptCalled = resolve;
    });
    let releaseReceipt: () => void = () => undefined;
    const receiptGate = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const observerItems: SubscribeStreamEvent[] = [
      {
        type: "event",
        event: {
          seq: 1,
          ref,
          type: "session.turn.started",
          turnId: "turn-1",
          messageId: "message-1",
        },
      },
      {
        type: "event",
        event: {
          seq: 2,
          ref,
          type: "session.message.chunk",
          turnId: "turn-1",
          chunk: { type: "text-delta", id: "m1", delta: "mine" },
        },
      },
      {
        type: "event",
        event: { seq: 3, ref, type: "session.turn.ended", turnId: "turn-1", outcome: "completed" },
      },
    ];
    let subscribeCalls = 0;
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => {
        // Hold the observer hydrate until the prompt is in flight, so the
        // turn's events race ahead of the receipt — the window under test.
        await promptCalledOnce;
        return { ...snapshot, status: { phase: "idle" }, pendingRequests: [], cursor: 0 };
      },
      prompt: async () => {
        promptCalled();
        await receiptGate;
        return { turnId: "turn-1" };
      },
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: noHistory,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscribeCalls += 1;
        // Call 1: the persistent observer subscription (subscribeSessionEvents
        // runs first). Call 2: the sendMessages prompt stream.
        if (subscribeCalls === 1) return asyncIterableOf(observerItems, releaseReceipt);
        return hangingIterableOf(observerItems);
      },
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);
    const observedChunks: string[] = [];
    const observedEnds: string[] = [];
    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onTurnChunk: (turnId) => observedChunks.push(turnId),
      onTurnEnded: (turnId) => observedEnds.push(turnId),
    });

    const chunks = await readAll(await transport.sendMessages(sendOptions));
    unsubscribe();

    // The prompt stream owns the turn's chunks; the observer saw none of them.
    expect(chunks).toEqual([{ type: "text-delta", id: "m1", delta: "mine" }]);
    expect(observedChunks).toEqual([]);
    expect(observedEnds).toEqual([]);
  });

  it("treats an already-answered request response as resolved", async () => {
    const makeSession = (failure: unknown) => ({
      getSnapshot: unexpectedCall,
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: unexpectedCall,
      respondToAgentRequest: async (): Promise<void> => {
        throw failure;
      },
      subscribe: unexpectedCall,
    });
    const answer = { type: "question", answers: [] } as const;

    // NOT_FOUND = another client answered first: the desired outcome holds.
    const raced = new OrpcChatSessionTransport(
      { session: makeSession(new ORPCError("NOT_FOUND")) } satisfies ChatTransportClient,
      ref,
    );
    await expect(raced.respondToAgentRequest("request-1", answer)).resolves.toBeUndefined();

    // Anything else still propagates untouched.
    const failure = new Error("network down");
    const failing = new OrpcChatSessionTransport(
      { session: makeSession(failure) } satisfies ChatTransportClient,
      ref,
    );
    await expect(failing.respondToAgentRequest("request-1", answer)).rejects.toBe(failure);
  });
});

// Yields `items`, then hangs forever: the stream may only end through an
// explicit `return` in promptChunks, never by the iterable running dry — so a
// missing termination guard shows up as a test timeout, not a false pass.
const hangingIterableOf = (
  items: readonly SubscribeStreamEvent[],
): AsyncIterable<SubscribeStreamEvent> => ({
  [Symbol.asyncIterator]() {
    let index = 0;
    return {
      next: () => {
        const item = items[index];
        index += 1;
        if (item) return Promise.resolve({ done: false as const, value: item });
        return new Promise<never>(() => undefined);
      },
    };
  },
});

const userMessage: UIMessage = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

const sendOptions = {
  trigger: "submit-message" as const,
  chatId: "chat-1",
  messageId: undefined,
  messages: [userMessage],
  abortSignal: undefined,
};

const readAll = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) return chunks;
    chunks.push(result.value);
  }
};

describe("OrpcChatSessionTransport sendMessages recovery", () => {
  it("marks the turn started from a recovery snapshot with an empty buffer", async () => {
    // The subscription drops before any event arrives; the snapshot proves the
    // turn exists but has buffered nothing yet. `session.turn.started` is never
    // redelivered, so post-recovery chunks must still flow.
    let subscribeCalls = 0;
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-1" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-1",
          messageId: null,
          chunks: [],
          complete: false,
          truncated: false,
        },
        activePrompt: null,
        cursor: 1,
      }),
      prompt: async () => ({ turnId: "turn-1" }),
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: unexpectedCall,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscribeCalls += 1;
        if (subscribeCalls === 1) {
          return hangingIterableOf([{ type: "closed", reason: "stream_replaced" }]);
        }
        return hangingIterableOf([
          {
            type: "event",
            event: {
              seq: 2,
              ref,
              type: "session.message.chunk",
              turnId: "turn-1",
              chunk: { type: "text-delta", id: "m1", delta: "hi" },
            },
          },
          {
            type: "event",
            event: {
              seq: 3,
              ref,
              type: "session.turn.ended",
              turnId: "turn-1",
              outcome: "completed",
            },
          },
        ]);
      },
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);

    const chunks = await readAll(await transport.sendMessages(sendOptions));

    expect(subscribeCalls).toBe(2);
    expect(chunks).toEqual([{ type: "text-delta", id: "m1", delta: "hi" }]);
  });

  it("replays a completed retained buffer and terminates without further events", async () => {
    // The turn ended while we were disconnected: the snapshot's buffer is
    // marked complete. Replaying it must end the stream — waiting on the fresh
    // subscription would hang forever.
    let subscribeCalls = 0;
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "idle" },
        pendingRequests: [],
        activeTurn: {
          turnId: "turn-1",
          messageId: "m1",
          chunks: [
            {
              seq: 2,
              ref,
              type: "session.message.chunk",
              turnId: "turn-1",
              chunk: { type: "text-delta", id: "m1", delta: "tail" },
            },
          ],
          complete: true,
          truncated: false,
        },
        activePrompt: null,
        cursor: 3,
      }),
      prompt: async () => ({ turnId: "turn-1" }),
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: unexpectedCall,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscribeCalls += 1;
        if (subscribeCalls === 1) {
          return hangingIterableOf([{ type: "closed", reason: "stream_replaced" }]);
        }
        return hangingIterableOf([]);
      },
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);

    const chunks = await readAll(await transport.sendMessages(sendOptions));

    expect(chunks).toEqual([{ type: "text-delta", id: "m1", delta: "tail" }]);
  });

  it("maps a prompt CONFLICT onto a human-readable race explanation", async () => {
    const session = {
      getSnapshot: unexpectedCall,
      prompt: async (): Promise<{ turnId: string }> => {
        throw new ORPCError("CONFLICT");
      },
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: unexpectedCall,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => hangingIterableOf([]),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);

    await expect(transport.sendMessages(sendOptions)).rejects.toThrow(
      /another client is already running/i,
    );
  });

  it("terminates on session.crashed even before turn.started arrived", async () => {
    // A crash before our turn started means the turn will never run; no other
    // event is coming, so the crash itself must end the stream.
    const session = {
      getSnapshot: unexpectedCall,
      prompt: async () => ({ turnId: "turn-1" }),
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: unexpectedCall,
      respondToAgentRequest: unexpectedCall,
      subscribe: async () =>
        hangingIterableOf([
          { type: "event", event: { seq: 1, ref, type: "session.crashed", reason: "boom" } },
        ]),
    };
    const transport = new OrpcChatSessionTransport({ session } satisfies ChatTransportClient, ref);

    const chunks = await readAll(await transport.sendMessages(sendOptions));

    expect(chunks).toEqual([]);
  });
});

describe("OrpcChatSessionTransport history reconcile", () => {
  const historyMessages: UIMessage[] = [
    { id: "h-user", role: "user", parts: [{ type: "text", text: "hi" }] },
    { id: "h-reply", role: "assistant", parts: [{ type: "text", text: "settled reply" }] },
  ];

  it("re-reads history when a turn ends un-completed and delivers it via onHistoryReconcile", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let getMessagesCalls = 0;
    const items: SubscribeStreamEvent[] = [
      { type: "event", event: { seq: 8, ref, type: "session.turn.started", turnId: "turn-2" } },
      {
        type: "event",
        event: { seq: 9, ref, type: "session.turn.ended", turnId: "turn-2", outcome: "failed" },
      },
    ];
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ...snapshot,
        status: { phase: "idle" },
        pendingRequests: [],
        cursor: 7,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: async () => {
        getMessagesCalls += 1;
        return { messages: historyMessages };
      },
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf(items, finishStream),
    };
    const client = { session } satisfies ChatTransportClient;
    const transport = new OrpcChatSessionTransport(client, ref);
    const reconciled: (readonly UIMessage[])[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onHistoryReconcile: (messages) => reconciled.push(messages),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    // One read at attach (the floor), one for the failed-turn reconcile.
    expect(getMessagesCalls).toBe(2);
    expect(reconciled).toEqual([historyMessages]);
  });

  it("skips a truncated buffer at hydrate and reconciles from history when the turn ends", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let getMessagesCalls = 0;
    const items: SubscribeStreamEvent[] = [
      {
        type: "event",
        event: {
          seq: 9,
          ref,
          type: "session.message.chunk",
          turnId: "turn-2",
          chunk: { type: "text-delta", id: "m1", delta: " live tail" },
        },
      },
      {
        type: "event",
        event: { seq: 10, ref, type: "session.turn.ended", turnId: "turn-2", outcome: "completed" },
      },
    ];
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ref,
        status: { phase: "running", activeTurnId: "turn-2" },
        pendingRequests: [],
        // The buffer lost its head: replaying it would fold a broken message.
        activeTurn: {
          turnId: "turn-2",
          messageId: "m1",
          chunks: [
            {
              seq: 8,
              ref,
              type: "session.message.chunk",
              turnId: "turn-2",
              chunk: { type: "text-delta", id: "m1", delta: "retained tail" },
            },
          ],
          complete: false,
          truncated: true,
        },
        activePrompt: null,
        cursor: 8,
      }),
      prompt: unexpectedCall,
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: async () => {
        getMessagesCalls += 1;
        return { messages: historyMessages };
      },
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => asyncIterableOf(items, finishStream),
    };
    const client = { session } satisfies ChatTransportClient;
    const transport = new OrpcChatSessionTransport(client, ref);
    const chunks: UIMessageChunk[] = [];
    const endedTurns: string[] = [];
    const reconciled: (readonly UIMessage[])[] = [];

    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onTurnChunk: (_turnId, chunk) => chunks.push(chunk),
      onTurnEnded: (turnId) => endedTurns.push(turnId),
      onHistoryReconcile: (messages) => reconciled.push(messages),
    });
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    // Neither the buffered replay nor the live chunk reaches the fold — the
    // truncated turn is recovered wholesale from history at its end.
    expect(chunks).toEqual([]);
    expect(endedTurns).toEqual([]);
    expect(getMessagesCalls).toBe(2);
    expect(reconciled).toEqual([historyMessages]);
  });
});

describe("OrpcChatSessionTransport sender error-chunk reconcile", () => {
  it("reconciles from history when an own turn's stream carried an error chunk but the turn completed", async () => {
    let finishStream: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let getMessagesCalls = 0;
    const historyMessages: UIMessage[] = [
      { id: "h-user", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "h-reply", role: "assistant", parts: [{ type: "text", text: "retried full reply" }] },
    ];
    // The prompt plane sees the error chunk and dies; the harness retries
    // internally and the turn still ends "completed" — only the persistent
    // subscription can heal the sender's view, via the history reconcile.
    const promptItems: SubscribeStreamEvent[] = [
      { type: "event", event: { seq: 8, ref, type: "session.turn.started", turnId: "turn-2" } },
      {
        type: "event",
        event: {
          seq: 9,
          ref,
          type: "session.message.chunk",
          turnId: "turn-2",
          chunk: { type: "error", errorText: "Connection error." },
        },
      },
      {
        type: "event",
        event: { seq: 10, ref, type: "session.turn.ended", turnId: "turn-2", outcome: "completed" },
      },
    ];
    const observerItems: SubscribeStreamEvent[] = structuredClone(promptItems);
    let subscribeCalls = 0;
    const session = {
      getSnapshot: async (): Promise<SessionRuntimeSnapshot> => ({
        ...snapshot,
        status: { phase: "idle" },
        pendingRequests: [],
        cursor: 7,
      }),
      prompt: async () => ({ turnId: "turn-2", cursor: 7, started: true }),
      interrupt: unexpectedCall,
      setModel: unexpectedCall,
      setReasoningEffort: unexpectedCall,
      setPermissionMode: unexpectedCall,
      getMessages: async () => {
        getMessagesCalls += 1;
        return { messages: historyMessages };
      },
      respondToAgentRequest: unexpectedCall,
      subscribe: async () => {
        subscribeCalls += 1;
        // First subscription is the persistent observer loop, second is the
        // prompt plane's own stream.
        return subscribeCalls === 1
          ? asyncIterableOf(observerItems, finishStream)
          : asyncIterableOf(promptItems);
      },
    };
    const client = { session } satisfies ChatTransportClient;
    const transport = new OrpcChatSessionTransport(client, ref);
    const reconciled: (readonly UIMessage[])[] = [];
    const unsubscribe = transport.subscribeSessionEvents({
      onRequest: () => undefined,
      onHistoryReconcile: (messages) => reconciled.push(messages),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stream = await transport.sendMessages({
      chatId: "chat",
      messageId: "m-1",
      messages: [{ id: "p-own", role: "user", parts: [{ type: "text", text: "hi" }] }],
      trigger: "submit-message",
    } as Parameters<typeof transport.sendMessages>[0]);
    const reader = stream.getReader();
    const chunks: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    // The own stream saw the error chunk...
    expect(chunks.some((c) => (c as { type?: string }).type === "error")).toBe(true);
    // ...and despite outcome "completed", the turn was reconciled from history.
    expect(getMessagesCalls).toBe(2);
    expect(reconciled).toEqual([historyMessages]);
  });
});
