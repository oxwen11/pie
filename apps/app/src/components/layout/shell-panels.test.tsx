// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Group } from "react-resizable-panels";
import { afterEach, describe, expect, it } from "vitest";

import { ResizablePanel } from "./resizable-panel";
import { ShellContentPanel } from "./shell-panels";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  },
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("shell panels", () => {
  it("clips the resizable panel content wrapper", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Group orientation="horizontal">
          <ShellContentPanel>
            <div>Content</div>
          </ShellContentPanel>
          <ResizablePanel id="filler" style={{ color: "red", overflow: "visible" }}>
            <div>Filler</div>
          </ResizablePanel>
        </Group>,
      );
    });

    const panel = container.querySelector<HTMLElement>("[data-testid=content]");
    const contentWrapper = panel?.firstElementChild as HTMLElement | null;
    const fillerWrapper = container.querySelector<HTMLElement>("[data-testid=filler]")
      ?.firstElementChild as HTMLElement | null;

    expect(panel?.parentElement?.dataset.group).toBe("true");
    expect(contentWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.color).toBe("red");
  });
});
