import { describe, expect, it } from "vitest";

import {
  activeTurn,
  assistantText,
  chunkEvent,
  defined,
  makeChat,
  settle,
  textChunks,
  userMessage,
} from "./chat-test-helpers";

function compactionData(message: { parts: ReadonlyArray<{ type: string; data?: unknown }> }) {
  const part = message.parts.find((entry) => entry.type === "data-compaction");
  return part && "data" in part ? part.data : undefined;
}

describe("Chat compaction", () => {
  it("keeps live messages, inserts a compact row, and continues in a new message", async () => {
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
    expect(compactionData(defined(chat.store.getState().messages.at(-1)))).toEqual({
      phase: "running",
    });
    live(7, {
      type: "session.compaction.ended",
      result: { outcome: "completed", summary: "Earlier work" },
      phase: "running",
    });
    expect(compactionData(defined(chat.store.getState().messages.at(-1)))).toEqual({
      phase: "completed",
      summary: "Earlier work",
    });
    live(8, {
      type: "session.message.chunk",
      turnId: "t",
      chunk: { type: "start", messageId: "new-answer" },
    });
    for (const [i, chunk] of textChunks("after", "new text").entries()) {
      live(9 + i, { type: "session.message.chunk", turnId: "t", chunk });
    }
    await settle();
    const ids = chat.store.getState().messages.map((message) => message.id);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe("old");
    expect(ids[1]).toBe("old-answer");
    expect(ids[3]).toBe("new-answer");
    expect(ids[2]).not.toBe("old-answer");
    expect(assistantText(defined(chat.store.getState().messages[1]))).toBe("old text");
    expect(assistantText(defined(chat.store.getState().messages[3]))).toBe("new text");
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
      expect(chat.store.getState().messages).toHaveLength(2);
      expect(chat.store.getState().messages[0]?.id).toBe("answer");
      expect(assistantText(defined(chat.store.getState().messages[0]))).toBe("beforeafter");
      expect(compactionData(defined(chat.store.getState().messages[1]))).toEqual(
        outcome === "failed" ? { phase: "failed", error: "quota" } : { phase: "canceled" },
      );
    },
  );

  it("uses trimmed Session Messages as the cold floor without a compact marker", async () => {
    const { chat, attach, transport } = makeChat();
    transport.history = [userMessage("kept", "recent request")];
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
    expect(chat.store.getState().messages.map((message) => message.id)).toEqual(["kept", "tail"]);
    expect(assistantText(defined(chat.store.getState().messages[1]))).toBe("continuing");
  });

  it("restores the spinner and queues input while compacting without an active turn", async () => {
    const { chat, attach, transport } = makeChat();
    await attach({ compaction: true });
    expect(compactionData(defined(chat.store.getState().messages[0]))).toEqual({
      phase: "running",
    });
    await chat.prompt("later");
    expect(transport.promptCalls[0]?.delivery).toBe("followUp");
    expect(chat.store.getState().messages.map((message) => message.role)).toEqual(["assistant"]);
  });
});
