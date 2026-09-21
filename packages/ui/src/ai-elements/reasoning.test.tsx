import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { Reasoning, ReasoningTrigger } from "./reasoning";

describe("Reasoning trigger", () => {
  it("does not stay on Thinking when a finished block mounts", async () => {
    await render(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("Thought");
  });

  it("switches off Thinking when the block finishes streaming", async () => {
    const screen = await render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    await expect.element(page.getByRole("button")).toHaveTextContent("Thinking…");

    await screen.rerender(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("Thought");
  });

  it("uses a provided duration after streaming ends", async () => {
    await render(
      <Reasoning isStreaming={false} duration={4} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("Thought for 4 seconds");
  });

  it("uses the Tool-style control at the left instead of a right-side chevron", async () => {
    await render(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    const trigger = page.getByRole("button");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");

    const node = trigger.element();
    expect(node.className).toContain("group");
    expect(node.className).toContain("leading-5");
    expect(node.className).toContain("gap-2.5");
    const loader = node.querySelector('[data-slot="pie-loader"]');
    expect(loader?.parentElement?.className).toContain("size-4");
    expect(loader?.className).not.toContain("size-full");
    expect(node.querySelector(".lucide-square-plus")?.getAttribute("class")).toContain("size-full");
    expect(node.querySelector(".lucide-square-minus")?.getAttribute("class")).toContain(
      "size-full",
    );
    expect(node.querySelector(".lucide-chevron-down")).toBeNull();

    await trigger.click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("animates the pie loader while streaming and freezes it once settled", async () => {
    const screen = await render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    const trigger = page.getByRole("button").element();
    expect(trigger.querySelector('[data-slot="pie-dot"]')?.className).toContain(
      "animate-pie-dot-grid",
    );
    expect(trigger.querySelector(".shimmer")).not.toBeNull();

    await screen.rerender(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    const settled = page.getByRole("button").element();
    expect(settled.querySelector('[data-slot="pie-loader"]')).not.toBeNull();
    expect(settled.querySelector('[data-slot="pie-dot"]')?.className).not.toContain(
      "animate-pie-dot-grid",
    );
    expect(settled.querySelector(".shimmer")).toBeNull();
  });

  it("treats a zero duration as unknown", async () => {
    await render(
      <Reasoning isStreaming={false} duration={0} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("Thought");
  });
});
