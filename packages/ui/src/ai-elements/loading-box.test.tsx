import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoadingBox } from "./loading-box";

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

describe("LoadingBox", () => {
  it("renders a polite status box", async () => {
    const el = await render(<LoadingBox>Thinking…</LoadingBox>);
    const box = el.querySelector("[data-slot=loading-box]");

    expect(box).not.toBeNull();
    expect(box?.getAttribute("role")).toBe("status");
    expect(box?.getAttribute("aria-live")).toBe("polite");
    expect(box?.getAttribute("aria-busy")).toBe("true");
    expect(box?.textContent).toBe("Thinking…");
  });

  it("merges a caller className last", async () => {
    const el = await render(<LoadingBox className="max-w-sm">Wait</LoadingBox>);
    const box = el.querySelector("[data-slot=loading-box]");

    expect(box?.className).toContain("max-w-sm");
  });
});
