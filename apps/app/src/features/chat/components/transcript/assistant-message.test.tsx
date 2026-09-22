// @vitest-environment jsdom
import type { PieUIMessage } from "@getpie/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantMessage } from "./assistant-message";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderParts(parts: PieUIMessage["parts"]): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(<AssistantMessage parts={parts} isStreaming={false} showActions={false} />),
  );
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("AssistantMessage", () => {
  it("renders compact AI SDK raster file parts that open a preview", async () => {
    const src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXkAAAAASUVORK5CYII=";
    const node = renderParts([
      { type: "file", mediaType: "image/png", filename: "result.png", url: src },
    ]);

    const image = node.querySelector("img");
    expect(image?.getAttribute("src")).toBe(src);
    expect(image?.getAttribute("alt")).toBe("result.png");
    expect(image?.className).toContain("max-h-44");
    expect(image?.className).toContain("sm:max-w-xs");

    let trigger: HTMLButtonElement | null = null;
    await act(async () => {
      await image?.decode();
      await new Promise(requestAnimationFrame);
    });
    await act(async () => {
      await vi.waitFor(() => {
        trigger = node.querySelector('button[aria-label="Expand image: result.png"]');
        expect(trigger).not.toBeNull();
      });
      trigger?.click();
    });

    await vi.waitFor(() => {
      const dialog = document.body.querySelector("dialog[open]");
      expect(dialog?.classList.contains("chat-image-preview-dialog")).toBe(true);
      expect(dialog?.querySelector("img")?.getAttribute("src")).toBe(src);
    });
  });

  it("does not render SVG file parts", () => {
    const node = renderParts([
      {
        type: "file",
        mediaType: "image/svg+xml",
        url: "data:image/svg+xml;base64,PHN2Zy8+",
      },
    ]);

    expect(node.querySelector("img")).toBeNull();
  });
});
