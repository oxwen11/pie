import type { SessionScopedEventBody } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import { foldSessionEvent, initialSessionState, toSnapshot } from "../../src/harness/session-fold";

const ref = { projectId: "p", sessionId: "s" };
const fold = (...events: SessionScopedEventBody[]) =>
  events.reduce(
    (state, event, index) => foldSessionEvent(state, { ...event, ref, seq: index + 1 }),
    initialSessionState,
  );

describe("compaction lifecycle", () => {
  it("hydrates the running status without changing the agent turn", () => {
    const state = fold(
      { type: "session.turn.started", turnId: "t" },
      { type: "session.compaction.started", reason: "overflow" },
    );
    const snapshot = toSnapshot(ref, state);
    expect(snapshot.compaction).toEqual({ reason: "overflow" });
    expect(snapshot.status).toEqual({ phase: "running", activeTurnId: "t" });
  });
  it.each(["canceled", "failed"] as const)(
    "clears the spinner on %s without dropping buffered messages",
    (outcome) => {
      const state = fold(
        { type: "session.turn.started", turnId: "t" },
        { type: "session.message.chunk", turnId: "t", chunk: { type: "start", messageId: "m" } },
        { type: "session.compaction.started", reason: "manual" },
        {
          type: "session.compaction.ended",
          result: outcome === "failed" ? { outcome, error: "quota" } : { outcome },
        },
      );
      expect(state.compaction).toBeNull();
      expect(state.activeTurn?.chunks).toHaveLength(1);
      expect(state.phase).toBe("running");
    },
  );
  it("replaces the replay floor and discards pre-compaction chunks without ending the turn", () => {
    const messages = [{ id: "compact", role: "assistant" as const, parts: [] }];
    const state = fold(
      { type: "session.turn.started", turnId: "t" },
      { type: "session.message.chunk", turnId: "t", chunk: { type: "start", messageId: "old" } },
      { type: "session.compaction.ended", result: { outcome: "completed", messages } },
      { type: "session.message.chunk", turnId: "t", chunk: { type: "start", messageId: "new" } },
    );
    const snapshot = toSnapshot(ref, state);
    expect(snapshot.transcriptReset).toEqual({ seq: 3, messages });
    expect(snapshot.activeTurn?.chunks.map((e) => e.seq)).toEqual([4]);
    expect(snapshot.activeTurn?.complete).toBe(false);
    expect(snapshot.status.phase).toBe("running");
  });

  it("clears compaction on crash", () => {
    expect(
      fold(
        { type: "session.compaction.started", reason: "threshold" },
        { type: "session.crashed", reason: "exit" },
      ).compaction,
    ).toBeNull();
  });
});
