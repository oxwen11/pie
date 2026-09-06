import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Reasoning, ReasoningTrigger } from "./reasoning";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function render(ui: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(ui);
  });
  return container;
}

function triggerText(el: HTMLDivElement): string {
  // Icons are SVG-only and the loader is aria-hidden, so text content is the label.
  return el.textContent?.trim() ?? "";
}

describe("Reasoning trigger", () => {
  it("does not stay on Thinking when a finished block mounts", async () => {
    const el = await render(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    expect(triggerText(el)).toBe("Thought");
  });

  it("switches off Thinking when the block finishes streaming", async () => {
    const el = await render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    expect(triggerText(el)).toBe("Thinking…");

    await act(async () => {
      root?.render(
        <Reasoning isStreaming={false} defaultOpen={false}>
          <ReasoningTrigger />
        </Reasoning>,
      );
    });

    expect(triggerText(el)).toBe("Thought");
  });

  it("uses a provided duration after streaming ends", async () => {
    const el = await render(
      <Reasoning isStreaming={false} duration={4} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    expect(triggerText(el)).toBe("Thought for 4 seconds");
  });

  it("uses the Tool-style control at the left instead of a right-side chevron", async () => {
    const el = await render(
      <Reasoning isStreaming={false} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    const trigger = el.querySelector('[data-slot="collapsible-trigger"]');
    if (!trigger) throw new Error("Reasoning trigger was not rendered");

    expect(trigger.className).toContain("group");
    expect(trigger.className).toContain("leading-5");
    expect(trigger.className).toContain("gap-2.5");
    const loader = trigger.querySelector('[data-slot="pie-loader"]');
    expect(loader?.parentElement?.className).toContain("size-(--dot-grid-size,1em)");
    expect(trigger.querySelector(".lucide-square-plus")?.getAttribute("class")).toContain(
      "size-full",
    );
    expect(trigger.querySelector(".lucide-square-minus")?.getAttribute("class")).toContain(
      "size-full",
    );
    expect(trigger.querySelector(".lucide-chevron-down")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("animates the pie loader while streaming and freezes it once settled", async () => {
    const el = await render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );
    expect(el.querySelector('[data-slot="pie-dot"]')?.className).toContain("animate-pie-dot-grid");
    expect(el.querySelector(".shimmer")).not.toBeNull();

    await act(async () => {
      root?.render(
        <Reasoning isStreaming={false} defaultOpen={false}>
          <ReasoningTrigger />
        </Reasoning>,
      );
    });

    expect(el.querySelector('[data-slot="pie-loader"]')).not.toBeNull();
    expect(el.querySelector('[data-slot="pie-dot"]')?.className).not.toContain(
      "animate-pie-dot-grid",
    );
    expect(el.querySelector(".shimmer")).toBeNull();
  });

  it("treats a zero duration as unknown", async () => {
    const el = await render(
      <Reasoning isStreaming={false} duration={0} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    expect(triggerText(el)).toBe("Thought");
  });
});
