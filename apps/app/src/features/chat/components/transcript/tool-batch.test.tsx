import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToolBatch } from "./tool-batch";
import type { IndexedBatchPart } from "./use-tool-batches";

// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate batch chrome from part renderers
vi.mock("./reasoning-part", () => ({ ReasoningPart: () => null }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- isolate batch chrome from part renderers
vi.mock("./tool-part", () => ({ ToolPart: () => <div>tool</div> }));

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
      type: "tool-read",
      toolCallId: "tool-0",
      state: "output-available",
      input: { path: "/tmp/file-0" },
      output: { content: [] as [], details: undefined },
    },
  },
];

const mixedParts = (): IndexedBatchPart[] => [
  {
    index: 0,
    part: {
      type: "tool-read",
      toolCallId: "done-read",
      state: "output-available",
      input: { path: "/tmp/done.ts" },
      output: { content: [] as [], details: undefined },
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

async function renderBatch(parts: IndexedBatchPart[], shouldShimmer: boolean) {
  const screen = await render(<ToolBatch parts={parts} shouldShimmer={shouldShimmer} />);
  const trigger = page.getBySlot("collapsible-trigger");
  await expect.element(trigger).toBeVisible();
  return { screen, trigger };
}

describe("ToolBatch", () => {
  it("stays collapsed by default and shows the in-flight tool action", async () => {
    const first = await renderBatch(runningParts(1), true);
    await expect.element(first.trigger).toHaveTextContent("Reading /tmp/file-0");
    await expect.element(first.trigger).toHaveAttribute("aria-expanded", "false");

    await first.trigger.click();
    await expect.element(first.trigger).toHaveAttribute("aria-expanded", "true");

    await first.screen.rerender(<ToolBatch parts={runningParts(2)} shouldShimmer />);
    await expect.element(first.trigger).toHaveTextContent("Reading /tmp/file-1");
    await expect.element(first.trigger).toHaveAttribute("aria-expanded", "true");

    await first.trigger.click();
    await expect.element(first.trigger).toHaveAttribute("aria-expanded", "false");

    await first.screen.rerender(<ToolBatch parts={completedParts()} shouldShimmer={false} />);
    await expect.element(first.trigger).toHaveTextContent("Read 1 file");
    await expect.element(first.trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps completed batches collapsed by default and toggleable", async () => {
    const { trigger } = await renderBatch(completedParts(), false);
    await expect.element(trigger).toHaveTextContent("Read 1 file");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("shows only the last in-flight action until every tool has settled", async () => {
    const { trigger } = await renderBatch(mixedParts(), true);
    await expect.element(trigger).toHaveTextContent("Running git status");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("aggregates completed Pi bash tools", async () => {
    const { trigger } = await renderBatch(
      [
        {
          index: 0,
          part: {
            type: "tool-bash",
            toolCallId: "b1",
            state: "output-available",
            input: { command: "git status" },
            output: { content: [] as [], details: {} },
          },
        },
      ],
      false,
    );
    await expect.element(trigger).toHaveTextContent("Ran 1 command");
  });
});
