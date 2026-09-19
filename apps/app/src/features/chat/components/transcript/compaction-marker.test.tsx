// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CompactionMarker, CompactionStatus } from "./compaction-marker";
import { MessageView } from "./message-view";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

describe("compaction markers", () => {
  it("announces progress with a spinner and shimmer, then stops both on failure", () => {
    const container = mount();
    act(() => root?.render(<CompactionStatus state={{ phase: "running", reason: "overflow" }} />));
    expect(container.querySelector("[role=status]")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".shimmer")?.textContent).toBe("Compacting conversation…");
    expect(container.querySelector("svg")).not.toBeNull();
    act(() =>
      root?.render(
        <CompactionStatus state={{ phase: "failed", error: "Compaction failed: quota" }} />,
      ),
    );
    expect(container.textContent).toBe("Compaction failed: quota");
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".shimmer")).toBeNull();
    act(() => root?.render(<CompactionStatus state={{ phase: "canceled" }} />));
    expect(container.textContent).toBe("Compaction canceled");
  });

  it("renders a separator and lazily mounts the summary through an accessible button", async () => {
    const container = mount();
    act(() => root?.render(<CompactionMarker summary="Earlier work is preserved." />));
    expect(container.querySelector<HTMLElement>("[data-slot=marker]")?.dataset.variant).toBe(
      "separator",
    );
    expect(container.textContent).not.toContain("Earlier work is preserved.");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button?.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Earlier work is preserved.");
  });

  it("keeps the compaction marker between retained and subsequent messages", () => {
    const container = mount();
    act(() =>
      root?.render(
        <>
          <MessageView
            message={{
              id: "before",
              role: "user",
              parts: [{ type: "text", text: "Retained request" }],
            }}
            isStreaming={false}
          />
          <MessageView
            message={{
              id: "compact",
              role: "assistant",
              parts: [{ type: "data-compaction", data: { summary: "Earlier work" } }],
            }}
            isStreaming={false}
          />
          <MessageView
            message={{
              id: "after",
              role: "user",
              parts: [{ type: "text", text: "Subsequent request" }],
            }}
            isStreaming={false}
          />
        </>,
      ),
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Retained request")).toBeLessThan(text.indexOf("Conversation compacted"));
    expect(text.indexOf("Conversation compacted")).toBeLessThan(text.indexOf("Subsequent request"));
    expect(text).not.toContain("Earlier work");
  });
});
