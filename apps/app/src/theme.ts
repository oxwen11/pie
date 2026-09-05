const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "dark" | "light" | "system";

type ResolvedTheme = Exclude<ThemePreference, "system">;

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}

/** Applies a theme preference and keeps system mode synchronized with the OS. */
export function startThemeSync(preference: ThemePreference): () => void {
  const systemTheme = window.matchMedia(DARK_MODE_QUERY);
  const applyTheme = () => {
    const theme = resolveTheme(preference, systemTheme.matches);
    document.documentElement.classList.toggle("dark", theme === "dark");
  };

  applyTheme();

  if (preference !== "system") return () => {};

  systemTheme.addEventListener("change", applyTheme);
  return () => systemTheme.removeEventListener("change", applyTheme);
}
