import { cn } from "@getpie/ui/lib/utils";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";
import { useStore } from "zustand";

import { SHELL_GUTTER_CLASS } from "@/components/layout/shell-chrome";
import { CONTENT_DEFAULT_PX, shellLayout } from "@/components/layout/shell-layout";

export function ShellContentPanel({
  children,
  collapsed,
  maximized,
  sessionKey,
}: {
  children: ReactNode;
  collapsed: boolean;
  maximized: boolean;
  sessionKey: string | null;
}): ReactNode {
  const stored = useStore(shellLayout.store, (state) =>
    sessionKey === null ? undefined : state.contentBySession[sessionKey],
  );
  const docked = stored ?? CONTENT_DEFAULT_PX;
  const canDrag = sessionKey !== null && !collapsed && !maximized;
  const drag = useRef<{ maxWidth: number; startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!canDrag) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const main = event.currentTarget.previousElementSibling;
    const content = event.currentTarget.nextElementSibling;
    const startWidth = content instanceof HTMLElement ? content.offsetWidth : docked;
    const mainWidth = main instanceof HTMLElement ? main.offsetWidth : 0;
    const mainMinWidth =
      main instanceof HTMLElement ? Number.parseFloat(getComputedStyle(main).minWidth) || 0 : 0;
    drag.current = {
      maxWidth: startWidth + Math.max(0, mainWidth - mainMinWidth),
      startX: event.clientX,
      startWidth,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null || sessionKey === null) return;
    shellLayout.setContentWidth(
      sessionKey,
      Math.min(
        drag.current.maxWidth,
        drag.current.startWidth - (event.clientX - drag.current.startX),
      ),
    );
  };
  const onPointerUp = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    shellLayout.persist();
  };

  return (
    <>
      <div
        aria-disabled={!canDrag || undefined}
        aria-orientation="vertical"
        aria-label="Resize content panel"
        className={cn(SHELL_GUTTER_CLASS, !canDrag && "w-0 after:hidden")}
        onLostPointerCapture={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
      />
      <aside
        className={cn(
          "flex min-h-0 flex-col overflow-hidden md:py-1 md:pe-1",
          maximized ? "min-w-0 flex-1" : "min-w-0 shrink",
        )}
        data-slot="content-panel-column"
        data-state={collapsed ? "hidden" : maximized ? "maximized" : "docked"}
        inert={collapsed}
        style={maximized ? undefined : { width: collapsed ? 0 : docked }}
      >
        <div className="flex h-full min-h-0 w-full flex-col">{children}</div>
      </aside>
    </>
  );
}
