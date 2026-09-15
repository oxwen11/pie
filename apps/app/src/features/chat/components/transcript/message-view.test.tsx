// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageView } from "./message-view";

// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate turn chrome from part renderers
vi.mock("./assistant-message", () => ({
  AssistantMessage: () => createElement("div", { "data-testid": "assistant" }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const toolMessage = {
  id: "a1",
  role: "assistant" as const,
  parts: [
    {
      type: "tool-read" as const,
      toolCallId: "t1",
      state: "output-available" as const,
      input: { path: "/tmp/a" },
      output: "ok",
    },
    { type: "text" as const, text: "done" },
  ],
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(
  isStreaming: boolean,
  times?: { previousTimestamp: string; timestamp: string },
): HTMLElement {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(
      createElement(MessageView, {
        isStreaming,
        previousTimestamp: times?.previousTimestamp,
        message:
          times === undefined
            ? toolMessage
            : { ...toolMessage, metadata: { timestamp: times.timestamp } },
      }),
    );
  });
  const trigger = host.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
  if (!trigger) throw new Error("Worked-for trigger was not rendered");
  return trigger;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  const mounted = root;
  act(() => mounted?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.useRealTimers();
});

describe("MessageView worked-for", () => {
  it("ticks Worked for while streaming and collapses with jsonl duration when settled", () => {
    let trigger = render(true);
    expect(trigger.textContent).toContain("Worked for 0s");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    trigger = render(true);
    expect(trigger.textContent).toContain("Worked for 3s");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    trigger = render(false, {
      previousTimestamp: "2026-01-01T00:00:00.000Z",
      timestamp: "2026-01-01T00:00:11.000Z",
    });
    expect(trigger.textContent).toContain("Worked for 11s");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
