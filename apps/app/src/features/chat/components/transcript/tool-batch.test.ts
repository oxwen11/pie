// @vitest-environment jsdom
import type { UIMessage } from "ai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolBatch } from "./tool-batch";
import type { IndexedBatchPart } from "./use-tool-batches";

vi.mock("./reasoning-part", () => ({ ReasoningPart: () => null }));
vi.mock("./tool-part", () => ({ ToolPart: () => createElement("div", null, "tool") }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message: UIMessage = {
  id: "message-1",
  role: "assistant",
  parts: [],
};

const runningParts = (count: number): IndexedBatchPart[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    part: {
      type: "tool-Read",
      toolCallId: `tool-${index}`,
      state: "input-available",
      input: { file_path: `/tmp/file-${index}` },
    },
  }));

const completedParts = (): IndexedBatchPart[] => [
  {
    index: 0,
    part: {
      type: "tool-Read",
      toolCallId: "tool-0",
      state: "output-available",
      input: { file_path: "/tmp/file-0" },
      output: "done",
    },
  },
];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(parts: IndexedBatchPart[], shouldShimmer: boolean): HTMLButtonElement {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }

  act(() => {
    root?.render(createElement(ToolBatch, { message, parts, shouldShimmer }));
  });

  const trigger = host.querySelector<HTMLButtonElement>("[data-slot='collapsible-trigger']");
  if (!trigger) throw new Error("Tool batch trigger was not rendered");
  return trigger;
}

function activate(trigger: HTMLButtonElement): void {
  act(() => trigger.click());
}

afterEach(() => {
  const mounted = root;
  act(() => mounted?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("ToolBatch", () => {
  it("preserves the user-selected open state while running parts stream and complete", () => {
    let trigger = render(runningParts(1), true);
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.textContent).toBe("Reading 1 file");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger = render(runningParts(2), true);
    expect(trigger.textContent).toBe("Reading 2 files");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    trigger = render(completedParts(), false);
    expect(trigger.textContent).toBe("Read 1 file");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps completed batches collapsed by default and toggleable", () => {
    const trigger = render(completedParts(), false);
    expect(trigger.textContent).toBe("Read 1 file");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
