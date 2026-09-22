// @vitest-environment jsdom
import type { PieUIMessage } from "@getpie/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

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
  it("renders AI SDK raster file parts", () => {
    const src = "data:image/png;base64,aGVsbG8=";
    const node = renderParts([
      { type: "file", mediaType: "image/png", filename: "result.png", url: src },
    ]);

    expect(node.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(node.querySelector("img")?.getAttribute("alt")).toBe("result.png");
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
