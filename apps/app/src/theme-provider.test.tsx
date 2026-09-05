// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./theme-provider";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function ThemeProbe(): ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("light")}>
      {theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  const systemTheme = Object.assign(new EventTarget(), {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  }) satisfies MediaQueryList;
  vi.stubGlobal(
    "matchMedia",
    vi.fn<Window["matchMedia"]>(() => systemTheme),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("exposes the active preference and applies updates", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ThemeProvider defaultTheme="dark">
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => button?.click());

    expect(button?.textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("vite-ui-theme")).toBe("light");
  });

  it("restores a stored preference", () => {
    localStorage.setItem("vite-ui-theme", "dark");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ThemeProvider defaultTheme="light">
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    expect(container.querySelector("button")?.textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("supports a custom storage key", () => {
    localStorage.setItem("pie:theme", "dark");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ThemeProvider defaultTheme="light" storageKey="pie:theme">
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("dark");

    act(() => button?.click());

    expect(localStorage.getItem("pie:theme")).toBe("light");
    expect(localStorage.getItem("vite-ui-theme")).toBeNull();
  });
});
