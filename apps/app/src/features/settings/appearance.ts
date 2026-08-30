import type { Theme } from "@getpie/contract";

export function resolveAppearance(theme: Theme, prefersDark: boolean): "light" | "dark" {
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

export const isTheme = (value: unknown): value is Theme =>
  value === "system" || value === "light" || value === "dark";
