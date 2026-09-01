import type { LayoutChangedMeta } from "react-resizable-panels";

export type UserLayoutListener = () => void;

export function notifyUserLayoutListeners(
  meta: LayoutChangedMeta,
  listeners: ReadonlySet<UserLayoutListener>,
): void {
  if (!meta.isUserInteraction) return;
  for (const listener of listeners) listener();
}

export interface SidebarUserLayout {
  expandedWidth?: number;
  open?: boolean;
}

export function resolveSidebarUserLayout(
  open: boolean,
  collapsed: boolean,
  width: number | undefined,
): SidebarUserLayout {
  const layout: SidebarUserLayout = {};
  if (collapsed === open) layout.open = !collapsed;
  if (!collapsed && width !== undefined && width > 0) layout.expandedWidth = width;
  return layout;
}
