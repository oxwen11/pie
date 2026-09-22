import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_THEME_STORAGE_KEY,
  isThemePreference,
  startThemeSync,
  type ThemePreference,
} from "./theme";

export type ThemeProviderProps = PropsWithChildren<{
  defaultTheme?: ThemePreference;
  /** Server-owned preference; wins over localStorage when present. */
  serverTheme?: ThemePreference;
  storageKey?: string;
}>;

export type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  storageKey: string;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(storageKey: string, defaultTheme: ThemePreference): ThemePreference {
  try {
    const storedTheme = localStorage.getItem(storageKey);
    if (isThemePreference(storedTheme)) return storedTheme;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  serverTheme,
  storageKey = DEFAULT_THEME_STORAGE_KEY,
}: ThemeProviderProps): ReactElement {
  const [localTheme, setLocalTheme] = useState<ThemePreference>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );
  const theme = serverTheme ?? localTheme;

  useLayoutEffect(() => {
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Keep the in-memory preference usable when storage is unavailable.
    }
    return startThemeSync(theme);
  }, [storageKey, theme]);

  const value = useMemo(
    () => ({
      theme,
      storageKey,
      setTheme: (nextTheme: ThemePreference) => {
        try {
          localStorage.setItem(storageKey, nextTheme);
        } catch {
          // Keep the in-memory preference usable when storage is unavailable.
        }
        setLocalTheme(nextTheme);
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
