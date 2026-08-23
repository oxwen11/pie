import type { Platform } from "@/platform";
import { isDesktopMacosHost } from "@/platform-host";

/** Matches `ShellSidebarPanel` `md:ps-1.5`. */
const SHELL_GUTTER_PX = 6;

/** Electron `trafficLightPosition.x` (see `main-window.ts`). */
const MACOS_TRAFFIC_LIGHT_X_PX = 22;

/** Standard hidden-inset traffic-light cluster width. */
const MACOS_TRAFFIC_LIGHT_CLUSTER_PX = 52;

const MACOS_TRAFFIC_LIGHTS_END_PX = MACOS_TRAFFIC_LIGHT_X_PX + MACOS_TRAFFIC_LIGHT_CLUSTER_PX;

/** Tight gap between traffic lights and the sidebar toggle. */
const MACOS_TOGGLE_GAP_PX = 4;

const MACOS_TOGGLE_LEFT_PX = MACOS_TRAFFIC_LIGHTS_END_PX + MACOS_TOGGLE_GAP_PX;

/** Gap between chrome controls in the titlebar row. */
const CHROME_GAP_PX = 8;

/** `SidebarTrigger` is `size-7`. */
const TOGGLE_SIZE_PX = 28;

/** Fixed desktop toggle immediately after native traffic lights. */
export const DESKTOP_MACOS_TOGGLE_LEFT_CLASS = `left-[${MACOS_TOGGLE_LEFT_PX}px]` as const;

/** Fixed desktop toggle flush with the shell's left gutter (win/linux). */
export const DESKTOP_TOGGLE_LEFT_CLASS = "left-1.5" as const;

const desktopToggleLeftPx = (platform: Platform): number =>
  isDesktopMacosHost(platform) ? MACOS_TOGGLE_LEFT_PX : SHELL_GUTTER_PX;

/** Card header inset when the sidebar is collapsed under a fixed toggle. */
export const desktopTitlebarChromeInsetClass = (platform: Platform): string => {
  const insetPx = desktopToggleLeftPx(platform) + TOGGLE_SIZE_PX + CHROME_GAP_PX;
  return `ps-[${insetPx}px]`;
};

/** Sidebar header inset so BrandMark clears the fixed toggle (desktop win/linux). */
export const DESKTOP_SIDEBAR_BRAND_INSET_CLASS =
  `ps-[${SHELL_GUTTER_PX + TOGGLE_SIZE_PX + CHROME_GAP_PX}px]` as const;

export function desktopToggleLeftClass(platform: Platform): string {
  return isDesktopMacosHost(platform) ? DESKTOP_MACOS_TOGGLE_LEFT_CLASS : DESKTOP_TOGGLE_LEFT_CLASS;
}
