import { cn } from "@getpie/ui/lib/utils";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";
import { useStore } from "zustand";

import { ShellGutter } from "@/components/layout/shell-gutter";
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
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!canDrag) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: docked };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null || sessionKey === null) return;
    shellLayout.setContentWidth(
      sessionKey,
      drag.current.startWidth - (event.clientX - drag.current.startX),
    );
  };
  const onPointerUp = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    shellLayout.persist();
  };

  return (
    <>
      <ShellGutter
        className={canDrag ? "bg-border w-px" : undefined}
        disabled={!canDrag}
        label="Resize content panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <aside
        className={cn(
          "flex min-h-0 flex-col overflow-hidden md:py-1 md:pe-1",
          maximized ? "min-w-0 flex-1" : "min-w-0",
        )}
        data-slot="content-panel-column"
        data-state={collapsed ? "hidden" : maximized ? "maximized" : "docked"}
        inert={collapsed}
        style={maximized ? undefined : { width: collapsed ? 0 : docked }}
      >
        {children}
      </aside>
    </>
  );
}
