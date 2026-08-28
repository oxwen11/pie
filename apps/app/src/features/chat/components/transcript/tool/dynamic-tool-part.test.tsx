// @vitest-environment jsdom
import type { DynamicToolUIPart } from "ai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { DynamicToolPart } from "./dynamic-tool-part";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderTool(part: DynamicToolUIPart): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rerenderTool(part);
  return container;
}

function rerenderTool(part: DynamicToolUIPart): void {
  act(() => root?.render(<DynamicToolPart part={part} name="read" />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("DynamicToolPart", () => {
  it("renders image blocks from a tool result instead of serializing their base64 data", () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const node = renderTool({
      type: "dynamic-tool",
      toolName: "read",
      toolCallId: "call-1",
      state: "output-available",
      input: { path: "/tmp/screenshot.png" },
      output: {
        content: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", data: base64, mimeType: "image/png" },
        ],
      },
    });

    expect(node.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${base64}`);
    expect(node.textContent).toContain("Read image file [image/png]");
    expect(node.querySelector('[data-slot="tool-image-output"] pre')).toBeNull();
  });

  it("opens when an image arrives after the tool card has mounted", () => {
    renderTool({
      type: "dynamic-tool",
      toolName: "read",
      toolCallId: "call-1",
      state: "input-available",
      input: { path: "/tmp/screenshot.png" },
    });

    rerenderTool({
      type: "dynamic-tool",
      toolName: "read",
      toolCallId: "call-1",
      state: "output-available",
      input: { path: "/tmp/screenshot.png" },
      output: {
        content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      },
    });

    expect(container?.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(container?.querySelector("img")).not.toBeNull();
  });

  it("does not embed SVG tool output as a data image", () => {
    const node = renderTool({
      type: "dynamic-tool",
      toolName: "read",
      toolCallId: "call-1",
      state: "output-available",
      input: { path: "/tmp/image.svg" },
      output: {
        content: [{ type: "image", data: "PHN2Zz48L3N2Zz4=", mimeType: "image/svg+xml" }],
      },
    });

    expect(node.querySelector("img")).toBeNull();
  });

  it("preserves unknown content blocks alongside images", () => {
    const node = renderTool({
      type: "dynamic-tool",
      toolName: "read",
      toolCallId: "call-1",
      state: "output-available",
      input: { path: "/tmp/screenshot.png" },
      output: {
        content: [
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          { type: "resource_link", uri: "file:///tmp/source.txt" },
        ],
      },
    });

    expect(node.querySelector("img")).not.toBeNull();
    expect(node.querySelector('[data-slot="tool-output-remainder"]')).not.toBeNull();
  });
});
