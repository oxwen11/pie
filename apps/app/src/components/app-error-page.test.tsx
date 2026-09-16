import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppErrorPage } from "./app-error-page";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderPage(error: unknown): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<AppErrorPage error={error} />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe("AppErrorPage", () => {
  it("shows the error and a reload action", () => {
    const view = renderPage(new Error("session boom"));

    expect(view.querySelector("[data-slot=app-error-page]")).not.toBeNull();
    expect(view.textContent).toContain("Pie ran into a problem");
    expect(view.textContent).toContain("session boom");
    expect(view.querySelector("button")?.textContent).toBe("Reload");
  });

  it("catches a child render error as the outermost fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Boom(): ReactElement {
      throw new Error("provider boom");
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ErrorBoundary FallbackComponent={AppErrorPage}>
          <Boom />
        </ErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("Pie ran into a problem");
    expect(container.textContent).toContain("provider boom");
    expect(container.textContent).not.toContain("Something went wrong!");
  });
});
