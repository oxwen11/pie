import type { LayoutChangedMeta } from "react-resizable-panels";

export type UserLayoutListener = () => void;

export function notifyUserLayoutListeners(
  meta: LayoutChangedMeta,
  listeners: ReadonlySet<UserLayoutListener>,
): void {
  if (!meta.isUserInteraction) return;
  for (const listener of listeners) listener();
}
