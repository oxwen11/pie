import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { formatWorkedFor, MessageView, splitWork, workedSeconds } from "./message-view";

// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate turn chrome from part renderers
vi.mock("./assistant-message", () => ({
  AssistantMessage: () => createElement("div", { "data-testid": "assistant" }),
}));

const text = (value: string) => ({ type: "text" as const, text: value });
const tool = (id: string) => ({
  type: "tool-read" as const,
  toolCallId: id,
  state: "output-available" as const,
  input: { path: "/tmp/a" },
  output: { content: [] as [], details: undefined },
});
const reasoning = { type: "reasoning" as const, text: "hm", state: "done" as const };

describe("splitWork", () => {
  it("keeps every part inside the wrapper while streaming", () => {
    expect(splitWork([text("hi"), tool("t1")], true)).toEqual({
      workParts: [text("hi"), tool("t1")],
      answerParts: [],
    });
  });

  it("returns null for an empty streaming message", () => {
    expect(splitWork([], true)).toBeNull();
  });

  it("returns null for a settled text-only turn", () => {
    expect(splitWork([text("hello")], false)).toBeNull();
  });

  it("peels the trailing answer off a settled turn with work", () => {
    expect(splitWork([text("looking"), tool("t1"), text("done")], false)).toEqual({
      workParts: [text("looking"), tool("t1")],
      answerParts: [text("done")],
    });
  });

  it("keeps everything inside when the last text is not at the tail", () => {
    expect(splitWork([text("looking"), tool("t1")], false)).toEqual({
      workParts: [text("looking"), tool("t1")],
      answerParts: [],
    });
  });

  it("folds a tools-only settled turn", () => {
    expect(splitWork([tool("t1"), reasoning], false)).toEqual({
      workParts: [tool("t1"), reasoning],
      answerParts: [],
    });
  });
});

describe("formatWorkedFor", () => {
  it("formats seconds and minutes", () => {
    expect(formatWorkedFor(0)).toBe("Worked for 0s");
    expect(formatWorkedFor(12)).toBe("Worked for 12s");
    expect(formatWorkedFor(60)).toBe("Worked for 1m");
    expect(formatWorkedFor(75)).toBe("Worked for 1m 15s");
  });
});

describe("workedSeconds", () => {
  it("is messageEndTimestamp minus messageStartTimestamp", () => {
    expect(
      workedSeconds({
        messageStartTimestamp: "2026-07-26T11:45:17.114Z",
        messageEndTimestamp: "2026-07-26T11:45:29.514Z",
      }),
    ).toBe(12);
    expect(workedSeconds({ messageEndTimestamp: "2026-07-26T11:45:29.514Z" })).toBeUndefined();
  });
});

const toolMessage = {
  id: "a1",
  role: "assistant" as const,
  parts: [
    {
      type: "tool-read" as const,
      toolCallId: "t1",
      state: "output-available" as const,
      input: { path: "/tmp/a" },
      output: { content: [] as [], details: undefined },
    },
    { type: "text" as const, text: "done" },
  ],
};

describe("MessageView worked-for", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks Worked for while streaming and collapses with jsonl duration when settled", async () => {
    const { rerender } = await render(<MessageView isStreaming message={toolMessage} />);
    const trigger = page.getBySlot("collapsible-trigger");
    await expect.element(trigger).toHaveTextContent("Worked for 0s");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");

    await vi.advanceTimersByTimeAsync(3000);
    await rerender(<MessageView isStreaming message={toolMessage} />);
    await expect.element(trigger).toHaveTextContent("Worked for 3s");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");

    await rerender(
      <MessageView
        isStreaming={false}
        message={{
          ...toolMessage,
          metadata: {
            sessionId: "s1",
            messageStartTimestamp: "2026-01-01T00:00:00.000Z",
            messageEndTimestamp: "2026-01-01T00:00:11.000Z",
          },
        }}
      />,
    );
    await expect.element(trigger).toHaveTextContent("Worked for 11s");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("counts from messageStartTimestamp and keeps that start across remount", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    const streaming = (
      <MessageView
        isStreaming
        message={{
          ...toolMessage,
          metadata: {
            sessionId: "s1",
            messageStartTimestamp: "2026-01-01T00:00:00.000Z",
          },
        }}
      />
    );
    const first = await render(streaming);
    const trigger = page.getBySlot("collapsible-trigger");
    await expect.element(trigger).toHaveTextContent("Worked for 5s");

    await first.unmount();
    const second = await render(streaming);
    await expect.element(page.getBySlot("collapsible-trigger")).toHaveTextContent("Worked for 5s");

    await vi.advanceTimersByTimeAsync(2000);
    await second.rerender(streaming);
    await expect.element(page.getBySlot("collapsible-trigger")).toHaveTextContent("Worked for 7s");
  });
});
