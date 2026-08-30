import type { Theme } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useSyncExternalStore } from "react";

import type { AppClients } from "@/lib/orpc";

import { resolveAppearance } from "./appearance";

const subscribePrefersDark = (onStoreChange: () => void): (() => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
};

const getPrefersDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Resolves light/dark from operator settings plus the OS preference, and
 * writes the `dark` class onto `documentElement`. The query is part of that
 * job — not a thin useQuery wrapper.
 */
export function useResolvedAppearance(
  orpcQueryUtils: AppClients["orpcQueryUtils"],
): "light" | "dark" {
  const query = useQuery(orpcQueryUtils.settings.get.queryOptions());
  const prefersDark = useSyncExternalStore(subscribePrefersDark, getPrefersDark, getPrefersDark);
  const theme: Theme = query.data?.settings.ui.theme ?? "system";
  const resolved = resolveAppearance(theme, prefersDark);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  return resolved;
}
