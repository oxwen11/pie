import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { startThemeSync, type ThemePreference } from "./theme";

export type ThemeProviderProps = PropsWithChildren<{
  defaultTheme?: ThemePreference;
  storageKey?: string;
}>;

export type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(storageKey: string, defaultTheme: ThemePreference): ThemePreference {
  try {
    const storedTheme = localStorage.getItem(storageKey);
    if (storedTheme === "dark" || storedTheme === "light" || storedTheme === "system") {
      return storedTheme;
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
}: ThemeProviderProps): ReactElement {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );

  useLayoutEffect(() => startThemeSync(theme), [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (nextTheme: ThemePreference) => {
        try {
          localStorage.setItem(storageKey, nextTheme);
        } catch {
          // Keep the in-memory preference usable when storage is unavailable.
        }
        setThemeState(nextTheme);
      },
    }),
    [storageKey, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
