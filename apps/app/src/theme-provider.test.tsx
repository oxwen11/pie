import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ThemeProvider, useTheme } from "./theme-provider";

function ThemeProbe(): ReactElement {
  const { storageKey, theme, setTheme } = useTheme();
  return (
    <button data-storage-key={storageKey} type="button" onClick={() => setTheme("light")}>
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
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("exposes the active preference and applies updates", async () => {
    await render(
      <ThemeProvider defaultTheme="dark">
        <ThemeProbe />
      </ThemeProvider>,
    );

    const button = page.getByRole("button");
    await expect.element(button).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await button.click();

    await expect.element(button).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(button.element().dataset.storageKey).toBe("pie:theme");
    expect(localStorage.getItem("pie:theme")).toBe("light");
  });

  it("restores a stored preference", async () => {
    localStorage.setItem("pie:theme", "dark");
    await render(
      <ThemeProvider defaultTheme="light">
        <ThemeProbe />
      </ThemeProvider>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("supports a custom storage key", async () => {
    localStorage.setItem("custom-theme", "dark");
    await render(
      <ThemeProvider defaultTheme="light" storageKey="custom-theme">
        <ThemeProbe />
      </ThemeProvider>,
    );

    const button = page.getByRole("button");
    await expect.element(button).toHaveTextContent("dark");
    expect(button.element().dataset.storageKey).toBe("custom-theme");

    await button.click();

    expect(localStorage.getItem("custom-theme")).toBe("light");
    expect(localStorage.getItem("pie:theme")).toBeNull();
  });

  it("applies a server preference over localStorage", async () => {
    localStorage.setItem("pie:theme", "light");
    await render(
      <ThemeProvider defaultTheme="light" serverTheme="dark">
        <ThemeProbe />
      </ThemeProvider>,
    );

    await expect.element(page.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("pie:theme")).toBe("dark");
  });
});
