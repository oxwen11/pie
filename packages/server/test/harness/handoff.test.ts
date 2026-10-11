import type { PieUIMessage } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import {
  buildHandoffParts,
  HANDOFF_MIN_SELECTION_CHARS,
  HANDOFF_TOTAL_CHARS,
  HandoffDoesNotFitError,
} from "../../src/harness/handoff";

type Parts = PieUIMessage["parts"];
const message = (role: "user" | "assistant", ...parts: Parts): PieUIMessage =>
  role === "user"
    ? { id: crypto.randomUUID(), role, parts }
    : { id: crypto.randomUUID(), role, parts };
const text = (value: string): Parts[number] => ({ type: "text", text: value });
const contextOf = (parts: ReturnType<typeof buildHandoffParts>) =>
  parts[0]?.type === "text" ? parts[0].text : "";

describe("buildHandoffParts", () => {
  it("keeps the new prompt whole as its own part after the history", () => {
    const parts = buildHandoffParts([message("user", text("first"))], "do the next thing");
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ type: "text", text: "do the next thing" });
  });

  it("copies user and assistant text and command results, not reasoning, files or other tools", () => {
    const parts = buildHandoffParts(
      [
        message("user", text("request"), { type: "file", mediaType: "image/png", url: "data:x" }),
        message(
          "assistant",
          { type: "reasoning", text: "SECRET_THOUGHT" },
          text("answer"),
          {
            type: "tool-read",
            toolCallId: "read-1",
            state: "output-available",
            input: { path: "f" },
            output: { content: [], details: undefined },
          },
          {
            type: "tool-bash",
            toolCallId: "bash-1",
            state: "output-available",
            input: { command: "ls" },
            output: { content: [{ type: "text", text: "a.txt" }], details: {} },
          },
        ),
      ],
      "next",
    );
    const context = contextOf(parts);
    expect(context).toContain("user: request");
    expect(context).toContain("assistant: answer");
    expect(context).toContain("command: ls\nresult: a.txt");
    expect(context).not.toContain("SECRET_THOUGHT");
    expect(context).not.toContain("data:x");
  });

  it("keeps the original request and the newest entries, dropping the middle first", () => {
    const messages = Array.from({ length: 40 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", text(`${index}:${"w".repeat(3_900)}`)),
    );
    const context = contextOf(buildHandoffParts(messages, "next"));
    expect(context).toContain("user: 0:");
    expect(context).toContain("assistant: 39:");
    expect(context).not.toContain("user: 20:");
    expect(context).toMatch(/\[\d+ earlier entries omitted\]/);
    expect(context.length).toBeLessThanOrEqual(HANDOFF_TOTAL_CHARS);
  });

  it("fails rather than shorten the prompt when too little room is left", () => {
    const prompt = "p".repeat(HANDOFF_TOTAL_CHARS - HANDOFF_MIN_SELECTION_CHARS + 1);
    expect(() => buildHandoffParts([message("user", text("x"))], prompt)).toThrow(
      HandoffDoesNotFitError,
    );
    const exact = "p".repeat(HANDOFF_TOTAL_CHARS - HANDOFF_MIN_SELECTION_CHARS);
    expect(buildHandoffParts([message("user", text("x"))], exact)[1]).toEqual({
      type: "text",
      text: exact,
    });
  });
});
