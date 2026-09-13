// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveTheme, startThemeSync } from "./theme";

class StubMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media = "(prefers-color-scheme: dark)";
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;

  constructor(public matches: boolean) {
    super();
  }

  addListener(): void {}

  removeListener(): void {}

  setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

function stubSystemTheme(prefersDark: boolean): StubMediaQueryList {
  const systemTheme = new StubMediaQueryList(prefersDark);
  vi.stubGlobal(
    "matchMedia",
    vi.fn<Window["matchMedia"]>(() => systemTheme),
  );
  return systemTheme;
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("theme", () => {
  it("resolves explicit and system preferences", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("follows system theme changes until synchronization stops", () => {
    const systemTheme = stubSystemTheme(false);
    const stop = startThemeSync("system");

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    systemTheme.setMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    stop();
    systemTheme.setMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("supports explicit themes without observing the system", () => {
    const systemTheme = stubSystemTheme(false);

    startThemeSync("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    systemTheme.setMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    startThemeSync("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
