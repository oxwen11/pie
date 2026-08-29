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

const SE_DOTS = new Set(["11", "12", "15", "16"]);

describe("PieLoader", () => {
  it("renders a 4×4 even grid and kicks the southeast four", async () => {
    const el = await render(<PieLoader />);
    const mark = el.querySelector("[data-slot=pie-loader]");
    const dots = el.querySelectorAll<SVGCircleElement>("[data-slot=pie-dot]");

    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("role")).toBe("status");
    expect(mark?.getAttribute("aria-label")).toBe("Thinking");
    expect(dots).toHaveLength(16);
    expect([...dots].map((dot) => dot.dataset.dotIndex)).toEqual(
      Array.from({ length: 16 }, (_, index) => String(index + 1)),
    );

    for (const dot of dots) {
      const kicked = SE_DOTS.has(dot.dataset.dotIndex ?? "");
      expect(dot.dataset.kick).toBe(kicked ? "se" : undefined);
      expect(dot.hasAttribute("transform")).toBe(kicked);
    }
  });

  it("merges a caller className last", async () => {
    const el = await render(<PieLoader className="text-muted-foreground" />);
    const mark = el.querySelector("[data-slot=pie-loader]");

    expect(mark?.className).toContain("text-muted-foreground");
  });
});
