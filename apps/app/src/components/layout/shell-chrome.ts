import type { Platform } from "@/platform";
import { isDesktopMacosHost, isDesktopHost } from "@/platform-host";

/** Matches `ShellSidebarPanel` / `ShellMainPanel` `md:py-1.5` and `md:ps-1.5`. */
export const SHELL_GUTTER_PX = 6;

/** Shared header band (`h-10`). */
export const SHELL_TITLEBAR_HEIGHT_PX = 40;

/** Electron `trafficLightPosition.x` (see `main-window.ts`). */
const MACOS_TRAFFIC_LIGHT_X_PX = 22;

/** Standard hidden-inset traffic-light cluster width. */
const MACOS_TRAFFIC_LIGHT_CLUSTER_PX = 52;

const MACOS_TRAFFIC_LIGHTS_END_PX = MACOS_TRAFFIC_LIGHT_X_PX + MACOS_TRAFFIC_LIGHT_CLUSTER_PX;

/** Tight gap between traffic lights and the sidebar toggle. */
const MACOS_TOGGLE_GAP_PX = 4;

export const MACOS_TOGGLE_LEFT_PX = MACOS_TRAFFIC_LIGHTS_END_PX + MACOS_TOGGLE_GAP_PX;

/** Gap between chrome controls in the titlebar row. */
const CHROME_GAP_PX = 8;

/** `SidebarTrigger` is `size-7`. */
const TOGGLE_SIZE_PX = 28;

/** `BrandMark` icon + gap + “Pie” label (see `brand-mark.tsx`). */
const DESKTOP_BRAND_MARK_WIDTH_PX = 48;

/** Fixed chrome row — lines up with sidebar/card `h-10` headers under `md:py-1.5`. */
export const SHELL_TITLEBAR_TOP_CLASS = "top-1.5" as const;
export const SHELL_TITLEBAR_ROW_CLASS = "flex h-10 items-center" as const;

/** Desktop win/linux pins BrandMark beside the fixed toggle. */
export function showsBrandInFixedChrome(platform: Platform): boolean {
  return isDesktopHost(platform) && !isDesktopMacosHost(platform);
}

/** Inline-start offset for the fixed desktop toggle inside the titlebar row. */
export function desktopToggleInsetClass(platform: Platform): string {
  return isDesktopMacosHost(platform) ? `ms-[${MACOS_TOGGLE_LEFT_PX}px]` : "ms-1.5";
}

const desktopToggleLeftPx = (platform: Platform): number =>
  isDesktopMacosHost(platform) ? MACOS_TOGGLE_LEFT_PX : SHELL_GUTTER_PX;

const desktopFixedChromeEndPx = (platform: Platform): number => {
  let end = desktopToggleLeftPx(platform) + TOGGLE_SIZE_PX;
  if (showsBrandInFixedChrome(platform)) {
    end += CHROME_GAP_PX + DESKTOP_BRAND_MARK_WIDTH_PX;
  }
  return end;
};

/** Card header inset when the sidebar is collapsed under fixed desktop chrome. */
export const desktopCollapsedCardInsetClass = (platform: Platform): string => {
  const insetPx = desktopFixedChromeEndPx(platform) + CHROME_GAP_PX;
  return `ps-[${insetPx}px]`;
};

/** Sidebar/card header row — reset `SidebarHeader` defaults and align with shell chrome. */
export const SHELL_TITLEBAR_HEADER_CLASS =
  "flex h-10 shrink-0 flex-row items-center gap-2 p-0 px-4" as const;

/** Card title cluster — matches `BrandMark` / toggle cap height. */
export const SHELL_TITLEBAR_LABEL_CLASS = "flex h-7 min-w-0 items-center gap-2 text-sm" as const;
