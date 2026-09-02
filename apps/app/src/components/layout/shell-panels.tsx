import { useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import {
  animate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import * as m from "motion/react-m";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  Group,
  type OnPanelResize,
  type PanelImperativeHandle,
  Separator,
  type SeparatorProps,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";
import {
  notifyUserLayoutListeners,
  resolveSidebarUserLayout,
  type UserLayoutListener,
} from "@/components/layout/shell-user-layout";

/** Resizable sidebar | chat | content-panel columns. */

const SHELL_LAYOUT_ID = "pie:shell-layout";
const SIDEBAR_DEFAULT_SIZE = "16rem";
const SIDEBAR_MIN_SIZE = "12rem";

const PANEL_IDS = {
  content: "content",
  main: "main",
  sidebar: "sidebar",
} as const;

type SubscribeToUserLayout = (listener: UserLayoutListener) => () => void;

const ShellLayoutContext = createContext<SubscribeToUserLayout | null>(null);

function useUserLayoutChanged(listener: UserLayoutListener): void {
  const subscribe = use(ShellLayoutContext);
  if (subscribe === null) throw new Error("Shell panels must be rendered inside ShellGroup");
  useEffect(() => subscribe(listener), [listener, subscribe]);
}

export function ShellGroup({
  hasSidebar,
  hasContentPanel,
  children,
}: {
  hasSidebar: boolean;
  hasContentPanel: boolean;
  children: ReactNode;
}): ReactNode {
  const panelIds = useMemo(
    () => [
      ...(hasSidebar ? [PANEL_IDS.sidebar] : []),
      PANEL_IDS.main,
      ...(hasContentPanel ? [PANEL_IDS.content] : []),
    ],
    [hasSidebar, hasContentPanel],
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: SHELL_LAYOUT_ID,
    // Do not persist transient imperative collapses.
    onlySaveAfterUserInteractions: true,
    panelIds,
    storage: localStorage,
  });
  const userLayoutListeners = useRef(new Set<UserLayoutListener>());
  const subscribeToUserLayout = useCallback<SubscribeToUserLayout>((listener) => {
    userLayoutListeners.current.add(listener);
    return () => {
      userLayoutListeners.current.delete(listener);
    };
  }, []);

  return (
    <ShellLayoutContext value={subscribeToUserLayout}>
      <Group
        className="flex min-h-0 w-full flex-1"
        defaultLayout={defaultLayout}
        resizeTargetMinimumSize={{ coarse: 28, fine: 18 }}
        onLayoutChanged={(layout, meta) => {
          notifyUserLayoutListeners(meta, userLayoutListeners.current);
          // Preserve the last expanded widths.
          if (Object.values(layout).some((size) => size === 0)) return;
          onLayoutChanged(layout, meta);
        }}
        orientation="horizontal"
      >
        {children}
      </Group>
    </ShellLayoutContext>
  );
}

/** Inter-card gutter and resize handle. */
export function ShellSeparator({
  className,
  disabled,
  joined = false,
  locked = false,
  ...props
}: SeparatorProps & { joined?: boolean; locked?: boolean }): ReactNode {
  return (
    <Separator
      className={cn(
        "relative bg-transparent [-webkit-app-region:no-drag] md:my-1",
        joined ? "bg-border w-px" : "w-1",
        "after:via-border after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-linear-to-b after:from-transparent after:to-transparent after:opacity-0 after:transition-[opacity,width]",
        "hover:after:via-foreground/20 data-[separator=focus]:after:via-foreground/20 data-[separator=active]:after:via-foreground/30 hover:after:opacity-100 data-[separator=active]:after:w-0.5 data-[separator=active]:after:opacity-100 data-[separator=focus]:after:opacity-100",
        disabled && "w-0 after:hidden",
        locked && "pointer-events-none",
        className,
      )}
      disabled={disabled || locked}
      {...props}
    />
  );
}

/** Binds app-owned collapsed state to the panel's imperative state. */
function useCollapsedBinding(
  panelRef: RefObject<PanelImperativeHandle | null>,
  collapsed: boolean,
  onCollapsedChange: (collapsed: boolean) => void,
  expandedSize: string,
): OnPanelResize {
  const laidOut = useRef(false);

  const sync = useCallback(
    (panel: PanelImperativeHandle): void => {
      if (collapsed === panel.isCollapsed()) return;
      if (collapsed) {
        panel.collapse();
        return;
      }
      panel.expand();
      if (panel.isCollapsed()) panel.resize(expandedSize);
    },
    [collapsed, expandedSize],
  );

  useLayoutEffect(() => {
    const panel = panelRef.current;
    // The imperative handle is only safe after the panel's first layout.
    if (panel === null || !laidOut.current) return;
    sync(panel);
  }, [collapsed, panelRef, sync]);

  return (size) => {
    const panel = panelRef.current;
    if (laidOut.current) {
      const isCollapsed = size.inPixels === 0;
      if (isCollapsed !== collapsed) onCollapsedChange(isCollapsed);
      return;
    }
    laidOut.current = true;
    if (panel !== null) sync(panel);
  };
}

/** True while the drawer width has not reached the `open` target. */
function sidebarDrawerInFlight(open: boolean, px: number, expandedPx: number): boolean {
  return open ? px < expandedPx - 0.5 : px > 0.5;
}

/**
 * Toggle springs the column width; the rail's `x` is `width - expanded` so the
 * contents slide as a drawer instead of squashing. Drag-resize stays a snap.
 * `minSize` is 0 while the spring is in flight — the panel group otherwise
 * refuses any `resize()` below 12rem.
 */
function useSidebarDrawer(
  open: boolean,
  setOpen: (open: boolean) => void,
  panelRef: RefObject<PanelImperativeHandle | null>,
  panelElementRef: RefObject<HTMLDivElement | null>,
) {
  const reduceMotion = useReducedMotion() === true;
  const laidOut = useRef(false);
  const skipNextAnimation = useRef(false);

  // The panel owns live width while open. Motion values only hold the remembered
  // expanded width and the transient width used during toggle animation.
  const expandedWidth = useMotionValue(256);
  const animatedWidth = useMotionValue(open ? 256 : 0);
  const drawerX = useTransform(() => animatedWidth.get() - expandedWidth.get());
  const rerenderAtSettle = useReducer((n: number) => n + 1, 0)[1];
  const inFlight = sidebarDrawerInFlight(open, animatedWidth.get(), expandedWidth.get());

  useMotionValueEvent(animatedWidth, "change", (value) => {
    if (sidebarDrawerInFlight(open, value, expandedWidth.get()) !== inFlight) {
      rerenderAtSettle();
    }
  });

  const settledOpen = open && !inFlight;
  const minSize = settledOpen ? SIDEBAR_MIN_SIZE : 0;

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null || !laidOut.current) return;

    if (skipNextAnimation.current) {
      skipNextAnimation.current = false;
      animatedWidth.jump(open ? expandedWidth.get() : 0);
      return;
    }

    if (reduceMotion) {
      animatedWidth.jump(open ? expandedWidth.get() : 0);
      if (open) {
        panel.expand();
        panel.resize(expandedWidth.get());
      } else if (!panel.isCollapsed()) {
        panel.collapse();
      }
      return;
    }

    const controls = animate(animatedWidth, open ? expandedWidth.get() : 0, {
      onUpdate(value) {
        if (value <= 0.5) {
          if (!panel.isCollapsed()) panel.collapse();
          return;
        }
        panel.resize(value);
      },
    });
    return () => controls.stop();
  }, [animatedWidth, expandedWidth, open, panelRef, reduceMotion]);

  const onResize: OnPanelResize = (size) => {
    const panel = panelRef.current;
    if (laidOut.current) return;

    laidOut.current = true;
    if (size.inPixels > 0) {
      const width = panelElementRef.current?.getBoundingClientRect().width ?? size.inPixels;
      expandedWidth.set(width);
      if (open) animatedWidth.set(width);
    }
    if (panel === null) return;
    if (!open && !panel.isCollapsed()) panel.collapse();
    if (open && panel.isCollapsed()) {
      panel.expand();
      if (panel.isCollapsed()) panel.resize(expandedWidth.get());
    }
  };

  const rememberUserLayout = useCallback(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    const layout = resolveSidebarUserLayout(
      open,
      panel.isCollapsed(),
      panelElementRef.current?.getBoundingClientRect().width,
    );
    if (layout.open !== undefined) {
      skipNextAnimation.current = true;
      setOpen(layout.open);
    }
    if (layout.expandedWidth === undefined) return;
    expandedWidth.set(layout.expandedWidth);
    animatedWidth.jump(layout.expandedWidth);
  }, [animatedWidth, expandedWidth, open, panelElementRef, panelRef, setOpen]);
  useUserLayoutChanged(rememberUserLayout);

  return {
    minSize,
    onResize,
    settledOpen,
    style: settledOpen ? { width: "100%", x: 0 } : { width: expandedWidth, x: drawerX },
    transitioning: inFlight,
  };
}

export function ShellSidebarPanel({
  children,
  separatorDisabled = false,
}: {
  children: ReactNode;
  separatorDisabled?: boolean;
}): ReactNode {
  const { open, setOpen } = useSidebar();
  const panelRef = usePanelRef();
  const panelElementRef = useRef<HTMLDivElement>(null);
  const drawer = useSidebarDrawer(open, setOpen, panelRef, panelElementRef);

  return (
    <>
      <ResizablePanel
        className="flex min-w-0 flex-col md:py-1 md:ps-1"
        collapsedSize={0}
        collapsible
        defaultSize={SIDEBAR_DEFAULT_SIZE}
        elementRef={panelElementRef}
        groupResizeBehavior="preserve-pixel-size"
        id={PANEL_IDS.sidebar}
        maxSize="30rem"
        minSize={drawer.minSize}
        onResize={drawer.onResize}
        panelRef={panelRef}
      >
        <m.div
          className={cn("flex h-full min-h-0 flex-col", drawer.settledOpen ? "w-full" : "shrink-0")}
          data-slot="sidebar-drawer"
          data-state={open ? "open" : "closed"}
          inert={!open}
          style={drawer.style}
        >
          {children}
        </m.div>
      </ResizablePanel>
      <ShellSeparator disabled={separatorDisabled} locked={drawer.transitioning} />
    </>
  );
}

export function ShellMainPanel({
  hasContentPanel,
  collapsible,
  collapsed,
  onCollapsedChange,
  children,
}: {
  /** Whether the content column is mounted. */
  hasContentPanel: boolean;
  /** Whether the chat column may collapse. */
  collapsible: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}): ReactNode {
  const panelRef = usePanelRef();
  const onResize = useCollapsedBinding(panelRef, collapsed, onCollapsedChange, "50%");

  return (
    <ResizablePanel
      className={cn(
        "flex min-w-0 flex-col md:py-1",
        !collapsed && "md:overflow-visible!",
        hasContentPanel
          ? "md:[&_[data-slot=sidebar-inset]]:rounded-e-none md:[&_[data-slot=sidebar-inset]]:border-e-0"
          : "md:pe-1",
      )}
      collapsedSize={0}
      collapsible={collapsible}
      id={PANEL_IDS.main}
      minSize="20rem"
      onResize={onResize}
      panelRef={panelRef}
    >
      {children}
    </ResizablePanel>
  );
}

export function ShellContentPanel({ children }: { children: ReactNode }): ReactNode {
  return (
    <ResizablePanel
      className="flex min-w-0 flex-col md:py-1 md:pe-1"
      defaultSize="28rem"
      groupResizeBehavior="preserve-pixel-size"
      id={PANEL_IDS.content}
      minSize="18rem"
    >
      {children}
    </ResizablePanel>
  );
}
