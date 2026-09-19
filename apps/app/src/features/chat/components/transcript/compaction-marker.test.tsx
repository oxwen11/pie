/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { CompactionMarker } from "./compaction-marker";
import { MessageView } from "./message-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function mount(node: Parameters<Root["render"]>[0]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

describe("compaction markers", () => {
  it("shows running, failed, and canceled states from the data part", () => {
    const running = mount(<CompactionMarker data={{ phase: "running" }} />);
    expect(running.textContent).toContain("Compacting conversation");
    act(() =>
      root?.render(
        <CompactionMarker data={{ phase: "failed", error: "Compaction failed: quota" }} />,
      ),
    );
    expect(container?.textContent).toContain("Compaction failed: quota");
    act(() => root?.render(<CompactionMarker data={{ phase: "canceled" }} />));
    expect(container?.textContent).toContain("Compaction canceled");
  });

  it("renders a completed summary marker from MessageView", () => {
    const node = mount(
      createElement(MessageView, {
        message: {
          id: "compact-1",
          role: "assistant",
          parts: [
            { type: "data-compaction", data: { phase: "completed", summary: "Earlier work" } },
          ],
        },
        isStreaming: false,
      }),
    );
    expect(node.textContent).toContain("Conversation compacted");
    expect(node.querySelector<HTMLElement>("[data-slot=marker]")?.dataset.variant).toBe(
      "separator",
    );
  });
});
