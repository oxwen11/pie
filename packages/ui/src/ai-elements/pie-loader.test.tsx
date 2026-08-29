import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PieLoader } from "./pie-loader";

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

describe("PieLoader", () => {
  it("renders sixteen dots as four pie-mark squares", async () => {
    const el = await render(<PieLoader />);
    const mark = el.querySelector("[data-slot=pie-loader]");
    const clusters = el.querySelectorAll("[data-slot=pie-cluster]");
    const dots = el.querySelectorAll("[data-slot=pie-dot]");

    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("role")).toBe("status");
    expect(mark?.getAttribute("aria-label")).toBe("Thinking");
    expect([...clusters].map((cluster) => cluster.dataset.corner)).toEqual([
      "nw",
      "ne",
      "sw",
      "se",
    ]);
    expect(dots).toHaveLength(16);
  });

  it("merges a caller className last", async () => {
    const el = await render(<PieLoader className="text-muted-foreground" />);
    const mark = el.querySelector("[data-slot=pie-loader]");

    expect(mark?.className).toContain("text-muted-foreground");
  });
});
