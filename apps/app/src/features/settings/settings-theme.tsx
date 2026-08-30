import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useSyncExternalStore } from "react";

import type { AppClients } from "@/lib/orpc";

import {
  applyDocumentTheme,
  getCachedTheme,
  persistTheme,
  resolveTheme,
  subscribeTheme,
  type Theme,
} from "./theme";

export function useThemePreference(): Theme {
  return useSyncExternalStore(subscribeTheme, getCachedTheme, getCachedTheme);
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}

/**
 * Keeps `document.documentElement` and the last-used theme cache in sync with
 * the server settings document. Mounted at the app composition root so every
 * route, including `/draft`, sees the saved appearance.
 */
export function SettingsThemeSync({
  orpcQueryUtils,
}: {
  orpcQueryUtils: AppClients["orpcQueryUtils"];
}) {
  const query = useQuery(orpcQueryUtils.settings.get.queryOptions());
  const preference = useThemePreference();
  const prefersDark = usePrefersDark();
  const serverTheme = query.data?.settings.appearance.theme;

  // Apply before paint so the cached preference does not flash the OS scheme.
  // persistTheme is an external store (localStorage + subscribers), not React
  // state — the feed is the host-pushed source `useSyncExternalStore` reads.
  useLayoutEffect(() => {
    applyDocumentTheme(resolveTheme(preference, prefersDark));
  }, [preference, prefersDark]);

  useLayoutEffect(() => {
    if (serverTheme !== undefined) persistTheme(serverTheme);
  }, [serverTheme]);

  return null;
}
