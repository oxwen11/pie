import {
  animate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { OnPanelResize, PanelImperativeHandle } from "react-resizable-panels";

import {
  applySidebarDrawerSize,
  readRemPx,
  SIDEBAR_DEFAULT_REM,
  SIDEBAR_DRAWER_TRANSITION,
  SIDEBAR_MIN_REM,
  SIDEBAR_MIN_SIZE,
  sidebarDrawerLayout,
} from "@/components/layout/sidebar-drawer";

export type SidebarDrawerMinSize = 0 | typeof SIDEBAR_MIN_SIZE;

export interface SidebarDrawerMotion {
  readonly minSize: SidebarDrawerMinSize;
  readonly onResize: OnPanelResize;
  /** Fill the panel once the spring is settled open so padding isn't clipped. */
  readonly fillPanel: boolean;
  readonly style: {
    readonly width: MotionValue<number>;
    readonly x: MotionValue<number>;
  };
}

/**
 * Springs the desktop sidebar column between its last expanded width and 0.
 * User drags keep the existing snap; only `open` flips from the toggle or
 * shortcut go through Motion.
 */
export function useSidebarDrawer({
  open,
  setOpen,
  panelRef,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  panelRef: RefObject<PanelImperativeHandle | null>;
}): SidebarDrawerMotion {
  const reduceMotion = useReducedMotion() === true;
  const laidOut = useRef(false);
  const skipAnimation = useRef(false);
  const animating = useRef(false);
  const progress = useMotionValue(open ? 0 : 1);
  const expandedWidth = useMotionValue(readRemPx(SIDEBAR_DEFAULT_REM));
  const x = useTransform(() => -expandedWidth.get() * progress.get());
  const [minSize, setMinSize] = useState<SidebarDrawerMinSize>(open ? SIDEBAR_MIN_SIZE : 0);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    // Relax the 12rem floor before the spring runs; otherwise resize() snaps.
    setMinSize(0);
  }

  useEffect(() => {
    const panel = panelRef.current;
    // The imperative handle is only safe after the panel's first layout.
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler
    if (panel === null || !laidOut.current) return;

    if (skipAnimation.current) {
      skipAnimation.current = false;
      progress.jump(open ? 0 : 1);
      if (!open) {
        setMinSize(0);
        return;
      }
      if (panel.getSize().inPixels >= readRemPx(SIDEBAR_MIN_REM)) {
        setMinSize(SIDEBAR_MIN_SIZE);
      }
      return;
    }

    if (reduceMotion) {
      progress.jump(open ? 0 : 1);
      applySidebarDrawerSize(panel, open ? expandedWidth.get() : 0);
      setMinSize(open ? SIDEBAR_MIN_SIZE : 0);
      return;
    }

    animating.current = true;
    const controls = animate(progress, open ? 0 : 1, {
      ...SIDEBAR_DRAWER_TRANSITION,
      onComplete() {
        animating.current = false;
        setMinSize(open ? SIDEBAR_MIN_SIZE : 0);
      },
      onUpdate(value) {
        applySidebarDrawerSize(panel, sidebarDrawerLayout(expandedWidth.get(), value).widthPx);
      },
    });

    return () => {
      animating.current = false;
      controls.stop();
    };
  }, [expandedWidth, open, panelRef, progress, reduceMotion]);

  const onResize: OnPanelResize = (size) => {
    const panel = panelRef.current;
    if (!laidOut.current) {
      laidOut.current = true;
      if (panel !== null) {
        if (!open && !panel.isCollapsed()) panel.collapse();
        if (open && panel.isCollapsed()) {
          panel.expand();
          if (panel.isCollapsed()) panel.resize(expandedWidth.get());
        }
      }
      if (size.inPixels > 0) expandedWidth.set(size.inPixels);
      return;
    }

    if (size.inPixels > 0 && !animating.current) {
      expandedWidth.set(size.inPixels);
      if (open && size.inPixels >= readRemPx(SIDEBAR_MIN_REM)) {
        setMinSize((current) => (current === SIDEBAR_MIN_SIZE ? current : SIDEBAR_MIN_SIZE));
      }
    }

    if (animating.current) return;

    const collapsed = size.inPixels === 0;
    if (collapsed === open) {
      skipAnimation.current = true;
      setOpen(!collapsed);
    }
  };

  return {
    fillPanel: open && minSize === SIDEBAR_MIN_SIZE,
    minSize,
    onResize,
    style: { width: expandedWidth, x },
  };
}
