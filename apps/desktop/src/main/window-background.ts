export type ThemePreference = "dark" | "light" | "system";

export const WINDOW_BACKGROUND_DARK = "#161616";
export const WINDOW_BACKGROUND_LIGHT = "#ffffff";

/**
 * Read `appearance.theme` from a `$PIE_HOME/settings.json` document. Missing,
 * unreadable, or invalid input reads as `undefined` (→ system) — the window
 * must still paint. Deliberately no `@getpie/contract` import: Electron Main
 * resolves workspace `src/*.ts` as plain Node ESM and cannot follow the
 * contract package's extensionless relative imports.
 */
export function readThemePreference(raw: string): ThemePreference | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("appearance" in parsed)) {
      return undefined;
    }
    const appearance = parsed.appearance;
    if (typeof appearance !== "object" || appearance === null || !("theme" in appearance)) {
      return undefined;
    }
    const theme = appearance.theme;
    return theme === "dark" || theme === "light" || theme === "system" ? theme : undefined;
  } catch {
    return undefined;
  }
}

export function windowBackgroundColor(
  theme: ThemePreference | undefined,
  systemPrefersDark: boolean,
): string {
  const dark = theme === "dark" || (theme !== "light" && systemPrefersDark);
  return dark ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}
