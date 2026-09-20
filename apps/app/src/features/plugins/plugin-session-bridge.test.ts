import type { SessionRef, SubscribeStreamEvent } from "@getpie/contract";
import { describe, expect, it, vi } from "vitest";

import {
  attachPluginSessionBridge,
  createPluginMessagePort,
  PI_SESSION_EVENT,
  type PluginFrame,
  type PluginPiSessionMessage,
  pluginSessionMessage,
} from "./plugin-session-bridge";

const ref: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-a",
};

const toolStart: SubscribeStreamEvent = {
  type: "event",
  event: {
    seq: 4,
    ref,
    type: "session.message.chunk",
    turnId: "turn-1",
    chunk: {
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "README.md" },
    },
  },
};

const toolEnd: SubscribeStreamEvent = {
  type: "event",
  event: {
    seq: 5,
    ref,
    type: "session.message.chunk",
    turnId: "turn-1",
    chunk: {
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { content: "ok" },
    },
  },
};

const turnStarted: SubscribeStreamEvent = {
  type: "event",
  event: {
    seq: 1,
    ref,
    type: "session.turn.started",
    turnId: "turn-1",
  },
};

describe("pluginSessionMessage", () => {
  it("forwards a Pi tool chunk and drops Pie collection events", () => {
    expect(pluginSessionMessage(ref, toolStart)).toEqual({
      type: PI_SESSION_EVENT,
      ref,
      event: toolStart.event,
    });

    const created: SubscribeStreamEvent = {
      type: "event",
      event: { ref, type: "session.created" },
    };
    expect(pluginSessionMessage(ref, created)).toBeNull();
    expect(pluginSessionMessage(ref, { type: "closed", reason: "session_closed" })).toBeNull();
  });
});

describe("createPluginMessagePort", () => {
  it("buffers until ready then posts a tool event", () => {
    const posted: unknown[] = [];
    const iframe: PluginFrame = {
      contentWindow: {
        postMessage: (data) => {
          posted.push(data);
        },
      },
    };
    const port = createPluginMessagePort(iframe);
    const message = pluginSessionMessage(ref, turnStarted);
    expect(message).toEqual({ type: PI_SESSION_EVENT, ref, event: turnStarted.event });
    if (message === null) return;
    port.deliver(message);
    expect(posted).toEqual([]);
    port.markReady();
    expect(posted).toEqual([message]);
  });

  it("posts live after ready without buffering", () => {
    const posted: unknown[] = [];
    const iframe: PluginFrame = {
      contentWindow: {
        postMessage: (data, targetOrigin) => {
          posted.push({ data, targetOrigin });
        },
      },
    };
    const port = createPluginMessagePort(iframe);
    port.markReady();
    const message = pluginSessionMessage(ref, toolEnd);
    expect(message).toEqual({ type: PI_SESSION_EVENT, ref, event: toolEnd.event });
    if (message === null) return;
    port.deliver(message);
    expect(posted).toEqual([{ data: message, targetOrigin: "*" }]);
  });
});

describe("attachPluginSessionBridge", () => {
  it("delivers session-scoped events from the subscribe stream", async () => {
    const delivered: PluginPiSessionMessage[] = [];
    const created: SubscribeStreamEvent = {
      type: "event",
      event: { ref, type: "session.created" },
    };
    const bridge = attachPluginSessionBridge({
      subscribe: async () =>
        (async function* () {
          yield created;
          yield toolStart;
        })(),
      ref,
      deliver: (message) => delivered.push(message),
    });
    await vi.waitFor(() => {
      expect(delivered).toEqual([{ type: PI_SESSION_EVENT, ref, event: toolStart.event }]);
    });
    bridge.detach();
  });
});
