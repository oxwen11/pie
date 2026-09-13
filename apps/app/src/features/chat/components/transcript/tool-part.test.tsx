// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ToolPart } from "./tool-part";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(part: Parameters<typeof ToolPart>[0]["part"]): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<ToolPart part={part} />));
  return host;
}

afterEach(() => {
  const mounted = root;
  act(() => mounted?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("ToolPart", () => {
  it("renders a Pi read as its path", () => {
    const view = render({
      type: "tool-read",
      toolCallId: "read-1",
      state: "output-available",
      input: { path: "/tmp/secret.txt" },
      output: { content: "must not render" },
    });

    expect(view.textContent).toBe("read /tmp/secret.txt");
  });

  it("does not render generic tool output", () => {
    const view = render({
      type: "dynamic-tool",
      toolName: "custom",
      toolCallId: "custom-1",
      state: "output-available",
      input: { query: "visible input" },
      output: "must not render",
    });

    expect(view.textContent).not.toContain("Output");
    expect(view.textContent).not.toContain("must not render");
  });
});
