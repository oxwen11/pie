import type { CSSProperties } from "react";

import type { Platform } from "@/platform";
import { isDesktopHost, isDesktopMacosHost } from "@/platform-host";

/** Matches `ShellSidebarPanel` / `ShellMainPanel` `md:py-1` and `md:ps-1`. */
const SHELL_GUTTER_PX = 4;

/** Electron `trafficLightPosition.x` (see `main-window.ts`). */
const MACOS_TRAFFIC_LIGHT_X_PX = 22;

/** Standard hidden-inset traffic-light cluster width. */
const MACOS_TRAFFIC_LIGHT_CLUSTER_PX = 52;

/** Clears the native traffic-light hit area before the sidebar toggle. */
const MACOS_TOGGLE_GAP_PX = 22;

/** Viewport offset of the fixed desktop toggle on macOS. */
export const MACOS_TOGGLE_LEFT_PX =
  MACOS_TRAFFIC_LIGHT_X_PX + MACOS_TRAFFIC_LIGHT_CLUSTER_PX + MACOS_TOGGLE_GAP_PX;

/** Gap between chrome controls in the titlebar row. */
const CHROME_GAP_PX = 8;

/** `SidebarTrigger` is `size-7`. */
const TOGGLE_SIZE_PX = 28;

const desktopToggleLeftPx = (platform: Platform): number =>
  isDesktopMacosHost(platform) ? MACOS_TOGGLE_LEFT_PX : SHELL_GUTTER_PX;

/** Viewport offset where titlebar content starts (after the fixed toggle). */
export function shellTitlebarContentLeftPx(platform: Platform): number {
  return desktopToggleLeftPx(platform) + TOGGLE_SIZE_PX + CHROME_GAP_PX;
}

/**
 * Desktop titlebar geometry. Consumed as complete Tailwind literals
 * (`start-[var(--shell-controls-left)]`, `ps-[var(--shell-titlebar-content-left)]`,
 * `ms-[var(--shell-sidebar-brand-inset)]`) so the scanner can see them.
 */
export function shellProviderStyle(platform: Platform): CSSProperties {
  if (!isDesktopHost(platform)) return {};

  const controlsLeft = desktopToggleLeftPx(platform);
  const contentLeft = shellTitlebarContentLeftPx(platform);

  return {
    "--shell-controls-left": `${controlsLeft}px`,
    "--shell-titlebar-content-left": `${contentLeft}px`,
    "--shell-sidebar-brand-inset": `${contentLeft - SHELL_GUTTER_PX}px`,
  } as CSSProperties;
}

/** Sidebar/card header row — reset `SidebarHeader` defaults and align with shell chrome. */
export const SHELL_TITLEBAR_HEADER_CLASS =
  "flex h-10 shrink-0 flex-row items-center gap-2 p-0 px-4" as const;

/** Card title cluster — matches `BrandMark` / toggle cap height. */
export const SHELL_TITLEBAR_LABEL_CLASS = "flex h-7 min-w-0 items-center gap-2 text-sm" as const;
