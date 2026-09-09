import type { PieUIMessage } from "@getpie/contract";
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
const marker: PieUIMessage = {
  id: "compact-1",
  role: "assistant",
  parts: [{ type: "data-compaction", data: { summary: "Earlier work" } }],
};
const projection = [retained, marker];

describe("Chat compaction", () => {
  it("replaces messages immediately mid-turn and prevents pending old fold writes from resurrecting them", async () => {
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
      result: { outcome: "completed", messages: projection },
      phase: "running",
    });
    expect(chat.store.getState().messages).toEqual(projection);
    expect(chat.store.getState().status).toBe("streaming");
    live(8, {
      type: "session.message.chunk",
      turnId: "t",
      chunk: { type: "start", messageId: "new-answer" },
    });
    for (const [i, chunk] of textChunks("after", "new text").entries()) {
      live(9 + i, { type: "session.message.chunk", turnId: "t", chunk });
    }
    await settle();
    expect(chat.store.getState().messages.map((m) => m.id)).toEqual([
      "kept",
      "compact-1",
      "new-answer",
    ]);
    expect(assistantText(defined(chat.store.getState().messages[2]))).toBe("new text");
    expect(transport.getMessagesCalls).toBe(1);
  });

  it.each(["canceled", "failed"] as const)(
    "does not reset the active fold when compaction is %s",
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

  it("hydrates an active compacted snapshot and replays only the new tail once", async () => {
    const { chat, attach, transport } = makeChat();
    transport.history = [userMessage("stale", "old floor")];
    const snapshot = {
      cursor: 14,
      status: { phase: "running" as const, activeTurnId: "t" },
      transcriptReset: { seq: 10, messages: projection },
      activeTurn: activeTurn({
        turnId: "t",
        chunks: [
          chunkEvent(11, "t", { type: "start", messageId: "tail" }),
          ...textChunks("after", "continuing").map((chunk, i) => chunkEvent(12 + i, "t", chunk)),
        ],
      }),
    };
    await attach(snapshot);
    await attach(snapshot);
    expect(chat.store.getState().messages.map((m) => m.id)).toEqual(["kept", "compact-1", "tail"]);
    expect(assistantText(defined(chat.store.getState().messages[2]))).toBe("continuing");
  });

  it("recovers a missed compaction on reconnect, even if the turn already finished", async () => {
    const { chat, attach, live } = makeChat();
    await attach({});
    live(1, {
      type: "session.message.chunk",
      turnId: "t",
      chunk: { type: "start", messageId: "old" },
    });
    await settle();
    await attach({
      cursor: 12,
      transcriptReset: { seq: 10, messages: projection },
      activeTurn: activeTurn({
        turnId: "t",
        complete: true,
        chunks: [chunkEvent(11, "t", { type: "finish" })],
      }),
    });
    expect(chat.store.getState().messages).toEqual(projection);
  });

  it("loads a compacted floor mid-stream when a later turn replaced the reset buffer", async () => {
    const { chat, attach, live, transport } = makeChat();
    await attach({});
    live(1, {
      type: "session.message.chunk",
      turnId: "old",
      chunk: { type: "start", messageId: "old-answer" },
    });
    await settle();
    transport.history = [...projection, userMessage("between", "completed after compact")];
    await attach({
      cursor: 24,
      lastCompactionSeq: 10,
      status: { phase: "running", activeTurnId: "new" },
      activeTurn: activeTurn({
        turnId: "new",
        chunks: [
          chunkEvent(21, "new", { type: "start", messageId: "new-answer" }),
          ...textChunks("after", "new text").map((chunk, i) => chunkEvent(22 + i, "new", chunk)),
        ],
      }),
    });
    expect(chat.store.getState().messages.map((m) => m.id)).toEqual([
      "kept",
      "compact-1",
      "between",
      "new-answer",
    ]);
    expect(chat.store.getState().status).toBe("streaming");
  });

  it("does not rewind settled history to a completed reset on a fresh page", async () => {
    const { chat, attach, transport } = makeChat();
    const history = [...projection, userMessage("later", "after compaction")];
    transport.history = history;
    await attach({
      cursor: 12,
      transcriptReset: { seq: 10, messages: projection },
      activeTurn: activeTurn({ turnId: "t", complete: true, chunks: [] }),
    });
    expect(chat.store.getState().messages).toEqual(history);
  });

  it("preserves a still-unacknowledged optimistic prompt across reset", async () => {
    const { chat, attach, live, transport } = makeChat();
    await attach({});
    let release = () => {};
    transport.promptGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = chat.prompt("not accepted yet");
    const optimistic = defined(chat.store.getState().messages[0]);
    live(1, {
      type: "session.compaction.ended",
      result: { outcome: "completed", messages: projection },
    });
    expect(chat.store.getState().messages).toEqual([...projection, optimistic]);
    live(2, {
      type: "session.prompt.submitted",
      messageId: optimistic.id,
      parts: [{ type: "text", text: "not accepted yet" }],
    });
    expect(chat.store.getState().messages).toHaveLength(3);
    release();
    await sent;
  });

  it("ignores a stale history response arriving after reset", async () => {
    const { chat, attach, live, transport } = makeChat();
    await attach({});
    let release = () => {};
    transport.history = [userMessage("old", "stale")];
    transport.historyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    live(1, { type: "session.turn.ended", turnId: "t", outcome: "failed", phase: "idle" });
    live(2, {
      type: "session.compaction.ended",
      result: { outcome: "completed", messages: projection },
    });
    release();
    await settle();
    expect(chat.store.getState().messages).toEqual(projection);
  });

  it("preserves the transcript and shows the reason if the compaction read crashes", async () => {
    const { chat, transport, attach, live } = makeChat();
    transport.history = [retained];
    await attach({});
    live(1, { type: "session.compaction.started", reason: "overflow" });
    live(2, {
      type: "session.crashed",
      reason: "Could not read the compacted conversation",
      phase: "crashed",
    });
    expect(chat.store.getState().messages).toEqual([retained]);
    expect(chat.store.getState().compaction).toBeNull();
    expect(chat.store.getState().error?.message).toBe("Could not read the compacted conversation");
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
