import type { PanelImperativeHandle } from "react-resizable-panels";

/**
 * Desktop sidebar toggle is a push drawer: the column width and the drawer
 * contents share one spring so the rail slides off-screen as a unit instead of
 * squashing session rows. Pair the progress with `applySidebarDrawerSize` —
 * react-resizable-panels snaps any `resize()` below `minSize` to either
 * `minSize` or `collapsedSize`, so the hook relaxes `minSize` for the flight
 * and restores `SIDEBAR_MIN_SIZE` when the drawer is settled open.
 *
 * Drag-resize stays a snap. This spring is only for the toggle / shortcut.
 */
export const SIDEBAR_DEFAULT_SIZE = "16rem" as const;
export const SIDEBAR_MIN_SIZE = "12rem" as const;
export const SIDEBAR_DEFAULT_REM = 16;
export const SIDEBAR_MIN_REM = 12;

export const SIDEBAR_DRAWER_TRANSITION = {
  bounce: 0.12,
  type: "spring",
  visualDuration: 0.24,
} as const;

export interface SidebarDrawerLayout {
  readonly widthPx: number;
  readonly x: number;
}

/** `progress` 0 is open, 1 is closed. */
export function sidebarDrawerLayout(expandedPx: number, progress: number): SidebarDrawerLayout {
  const p = progress < 0 ? 0 : Math.min(1, progress);
  const width = Math.max(expandedPx, 0);
  return {
    widthPx: width * (1 - p),
    // `-0` is a distinct IEEE value; keep the rest state a real zero.
    x: p === 0 || width === 0 ? 0 : -width * p,
  };
}

export function readRemPx(rem: number): number {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return rem * 16;
  const fontSize = Number.parseFloat(getComputedStyle(root).fontSize);
  return rem * (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16);
}

export function applySidebarDrawerSize(
  panel: Pick<PanelImperativeHandle, "collapse" | "isCollapsed" | "resize">,
  widthPx: number,
): void {
  if (widthPx <= 0.5) {
    if (!panel.isCollapsed()) panel.collapse();
    return;
  }
  panel.resize(widthPx);
}
