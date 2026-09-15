// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolBatch } from "./tool-batch";
import type { IndexedBatchPart } from "./use-tool-batches";

// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate batch chrome from part renderers
vi.mock("./reasoning-part", () => ({ ReasoningPart: () => null }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate batch chrome from part renderers
vi.mock("./tool-part", () => ({ ToolPart: () => createElement("div", null, "tool") }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const runningParts = (count: number): IndexedBatchPart[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    part: {
      type: "tool-read",
      toolCallId: `tool-${index}`,
      state: "input-available",
      input: { path: `/tmp/file-${index}` },
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

function render(parts: IndexedBatchPart[], shouldShimmer: boolean): HTMLElement {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }

  act(() => {
    root?.render(createElement(ToolBatch, { parts, shouldShimmer }));
  });

  const trigger = host.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
  if (!trigger) throw new Error("Tool batch trigger was not rendered");
  return trigger;
}

function activate(trigger: HTMLElement): void {
  act(() => trigger.click());
}

afterEach(() => {
  const mounted = root;
  act(() => mounted?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const mixedParts = (): IndexedBatchPart[] => [
  {
    index: 0,
    part: {
      type: "tool-read",
      toolCallId: "done-read",
      state: "output-available",
      input: { path: "/tmp/done.ts" },
      output: "ok",
    },
  },
  {
    index: 1,
    part: {
      type: "tool-bash",
      toolCallId: "run-bash",
      state: "input-available",
      input: { command: "git status" },
    },
  },
];

describe("ToolBatch", () => {
  it("stays collapsed by default and shows the in-flight tool action", () => {
    let trigger = render(runningParts(1), true);
    expect(trigger.textContent).toBe("Reading /tmp/file-0");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    trigger = render(runningParts(2), true);
    expect(trigger.textContent).toBe("Reading /tmp/file-1");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger = render(completedParts(), false);
    expect(trigger.textContent).toBe("Read 1 file");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps completed batches collapsed by default and toggleable", () => {
    const trigger = render(completedParts(), false);
    expect(trigger.textContent).toBe("Read 1 file");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    activate(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows only the last in-flight action until every tool has settled", () => {
    const trigger = render(mixedParts(), true);
    expect(trigger.textContent).toBe("Running git status");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("aggregates completed Pi bash tools", () => {
    const trigger = render(
      [
        {
          index: 0,
          part: {
            type: "tool-bash",
            toolCallId: "b1",
            state: "output-available",
            input: { command: "git status" },
            output: "ok",
          },
        },
      ],
      false,
    );
    expect(trigger.textContent).toBe("Ran 1 command");
  });
});
