import { describe, expect, it } from "vitest";

import {
  activeTurn,
  assistantText,
  defined,
  chunkEvent,
  makeChat,
  settle,
  textChunks,
  userMessage,
} from "./chat-test-helpers";

const retained = userMessage("kept", "recent request");
const marker = {
  id: "compact-1",
  role: "assistant" as const,
  parts: [{ type: "data-compaction" as const, data: { summary: "Earlier work" } }],
};

const projection = [retained, marker];

describe("Chat compaction", () => {
  it("keeps live messages and appends the same turn's continuation as a new message", async () => {
    const { chat, attach, live, transport } = makeChat();
    transport.history = [userMessage("old", "old request")];
    await attach({});
    live(1, { type: "session.turn.started", turnId: "t", phase: "running" });
    live(2, {
      type: "session.message.chunk",
      turnId: "t",
      chunk: { type: "start", messageId: "old-answer" },
    });
    for (const [i, chunk] of textChunks("before", "old text").entries()) {
      live(3 + i, { type: "session.message.chunk", turnId: "t", chunk });
    }
    live(6, { type: "session.compaction.started", reason: "overflow", phase: "running" });
    expect(chat.store.getState().compaction?.phase).toBe("running");
    live(7, {
      type: "session.compaction.ended",
      result: { outcome: "completed" },
      phase: "running",
    });
    expect(chat.store.getState().compaction).toBeNull();
    live(8, {
      type: "session.message.chunk",
      turnId: "t",
      chunk: { type: "start", messageId: "new-answer" },
    });
    for (const [i, chunk] of textChunks("after", "new text").entries()) {
      live(9 + i, { type: "session.message.chunk", turnId: "t", chunk });
    }
    await settle();
    expect(chat.store.getState().messages.map((message) => message.id)).toEqual([
      "old",
      "old-answer",
      "new-answer",
    ]);
    expect(assistantText(defined(chat.store.getState().messages[1]))).toBe("old text");
    expect(assistantText(defined(chat.store.getState().messages[2]))).toBe("new text");
    expect(transport.getMessagesCalls).toBe(1);
  });

  it.each(["canceled", "failed"] as const)(
    "keeps the active fold when compaction is %s",
    async (outcome) => {
      const { chat, attach, live } = makeChat();
      await attach({});
      live(1, {
        type: "session.message.chunk",
        turnId: "t",
        chunk: { type: "start", messageId: "answer" },
      });
      for (const [i, chunk] of textChunks("before", "before").entries()) {
        live(2 + i, { type: "session.message.chunk", turnId: "t", chunk });
      }
      live(5, { type: "session.compaction.started", reason: "threshold" });
      live(6, {
        type: "session.compaction.ended",
        result: outcome === "failed" ? { outcome, error: "quota" } : { outcome },
      });
      for (const [i, chunk] of textChunks("after", "after").entries()) {
        live(7 + i, { type: "session.message.chunk", turnId: "t", chunk });
      }
      await settle();
      expect(chat.store.getState().messages).toHaveLength(1);
      expect(assistantText(defined(chat.store.getState().messages[0]))).toBe("beforeafter");
      expect(chat.store.getState().compaction?.phase).toBe(outcome);
    },
  );

  it("uses the compacted Session Messages only as the cold floor", async () => {
    const { chat, attach, transport } = makeChat();
    transport.history = projection;
    await attach({
      cursor: 14,
      status: { phase: "running", activeTurnId: "t" },
      activeTurn: activeTurn({
        turnId: "t",
        chunks: [
          chunkEvent(11, "t", { type: "start", messageId: "tail" }),
          ...textChunks("after", "continuing").map((chunk, i) => chunkEvent(12 + i, "t", chunk)),
        ],
      }),
    });
    expect(chat.store.getState().messages.map((message) => message.id)).toEqual([
      "kept",
      "compact-1",
      "tail",
    ]);
    expect(assistantText(defined(chat.store.getState().messages[2]))).toBe("continuing");
  });

  it("restores the spinner and queues input while compacting without an active turn", async () => {
    const { chat, attach, transport } = makeChat();
    await attach({ compaction: { reason: "manual" } });
    expect(chat.store.getState().compaction?.phase).toBe("running");
    await chat.prompt("later");
    expect(transport.promptCalls[0]?.delivery).toBe("followUp");
    expect(chat.store.getState().messages).toEqual([]);
  });
});
