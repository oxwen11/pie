import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { MessageView } from "./message-view";

// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate turn chrome from part renderers
vi.mock("./assistant-message", () => ({
  AssistantMessage: () => createElement("div", { "data-testid": "assistant" }),
}));

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
          metadata: { messageStartTimestamp: "2026-01-01T00:00:00.000Z" },
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
