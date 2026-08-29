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
  it("renders sixteen CSS dots and no SVG", async () => {
    const el = await render(<PieLoader />);
    const mark = el.querySelector("[data-slot=pie-loader]");
    const dots = el.querySelectorAll("[data-slot=pie-dot]");

    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("role")).toBe("status");
    expect(mark?.getAttribute("aria-label")).toBe("Thinking");
    expect(mark?.querySelector("svg")).toBeNull();
    expect(dots).toHaveLength(16);
  });

  it("merges a caller className last", async () => {
    const el = await render(<PieLoader className="text-muted-foreground" />);
    const mark = el.querySelector("[data-slot=pie-loader]");

    expect(mark?.className).toContain("text-muted-foreground");
  });

  it("maps size to --dot-grid-size", async () => {
    const el = await render(<PieLoader size={12} />);
    const mark = el.querySelector<HTMLSpanElement>("[data-slot=pie-loader]");

    expect(mark?.style.getPropertyValue("--dot-grid-size")).toBe("12px");
    expect(mark?.style.width).toBe("12px");
    expect(mark?.style.height).toBe("12px");
  });
});
