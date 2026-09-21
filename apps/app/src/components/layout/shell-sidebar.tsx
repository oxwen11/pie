import { useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef } from "react";
import { useStore } from "zustand";

import { shellLayout } from "@/components/layout/shell-layout";
import { SHELL_GUTTER_CLASS } from "@/components/layout/shell-panels";

export function ShellSidebarPanel({
  children,
  separatorDisabled = false,
}: {
  children: ReactNode;
  separatorDisabled?: boolean;
}): ReactNode {
  const { open } = useSidebar();
  const reduceMotion = useReducedMotion() === true;
  const expanded = useStore(shellLayout.store, (state) => state.sidebarWidth);
  const expandedRef = useRef(expanded);
  const columnWidth = useMotionValue(open ? expanded : 0);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const target = open ? expanded : 0;
    if (reduceMotion || drag.current !== null) {
      columnWidth.jump(target);
      return undefined;
    }
    const controls = animate(columnWidth, target);
    return () => controls.stop();
  }, [columnWidth, expanded, open, reduceMotion]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (separatorDisabled || !open) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    expandedRef.current = expanded;
    drag.current = { startX: event.clientX, startWidth: expanded };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return;
    shellLayout.setSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    const next = shellLayout.store.getState().sidebarWidth;
    expandedRef.current = next;
    columnWidth.jump(next);
  };
  const onPointerUp = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    shellLayout.setSidebarWidth(expandedRef.current, true);
  };

  return (
    <>
      <m.aside
        className="flex min-h-0 shrink-0 flex-col overflow-hidden md:py-1 md:ps-1"
        data-slot="sidebar-drawer"
        data-state={open ? "open" : "closed"}
        inert={!open}
        style={{ width: columnWidth }}
      >
        <div className="flex h-full min-h-0 shrink-0 flex-col" style={{ width: expanded }}>
          {children}
        </div>
      </m.aside>
      <div
        aria-disabled={separatorDisabled || !open || undefined}
        aria-orientation="vertical"
        aria-label="Resize session list"
        className={cn(SHELL_GUTTER_CLASS, (separatorDisabled || !open) && "w-0 after:hidden")}
        onLostPointerCapture={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
      />
    </>
  );
}
