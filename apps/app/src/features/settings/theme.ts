export const THEME_STORAGE_KEY = "pie:theme:v1";

export type Theme = "system" | "light" | "dark";

const THEMES: ReadonlySet<string> = new Set(["system", "light", "dark"]);

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.has(value);
}

export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  switch (theme) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
      return prefersDark ? "dark" : "light";
    default: {
      const exhaustive: never = theme;
      return exhaustive;
    }
  }
}

export function applyDocumentTheme(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

function readStoredTheme(): Theme | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

let cachedTheme: Theme = readStoredTheme() ?? "system";
const listeners = new Set<() => void>();

export function getCachedTheme(): Theme {
  return cachedTheme;
}

export function subscribeTheme(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function persistTheme(theme: Theme): void {
  if (cachedTheme === theme) return;
  cachedTheme = theme;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Private mode, quota, or disabled storage.
    }
  }
  for (const listener of listeners) listener();
}

if (typeof document !== "undefined") {
  applyDocumentTheme(
    resolveTheme(
      cachedTheme,
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : false,
    ),
  );
}
