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
  return el.querySelector("p")?.textContent ?? "";
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
    expect(triggerText(el)).toBe("Thinking...");

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

  it("treats a zero duration as unknown", async () => {
    const el = await render(
      <Reasoning isStreaming={false} duration={0} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>,
    );

    expect(triggerText(el)).toBe("Thought");
  });
});
