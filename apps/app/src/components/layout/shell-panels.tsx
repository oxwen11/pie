import { useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  type UserLayoutListener,
} from "@/components/layout/shell-user-layout";

/** Chat | content-panel columns. Session list is a sibling pixel column. */

const SHELL_LAYOUT_ID = "pie:shell-layout";
const SIDEBAR_WIDTH_KEY = "pie:sidebar-width";
const SIDEBAR_MIN_PX = 192;
const SIDEBAR_MAX_PX = 480;
const SIDEBAR_DEFAULT_PX = 256;
const CONTENT_DEFAULT_SIZE = "28rem";
const CONTENT_MIN_SIZE = "18rem";

const PANEL_IDS = {
  content: "content",
  main: "main",
} as const;

type SubscribeToUserLayout = (listener: UserLayoutListener) => () => void;

const ShellLayoutContext = createContext<SubscribeToUserLayout | null>(null);

function useUserLayoutChanged(listener: UserLayoutListener): void {
  const subscribe = use(ShellLayoutContext);
  if (subscribe === null) throw new Error("Shell panels must be rendered inside ShellGroup");
  const onUserLayoutChanged = useEffectEvent(listener);
  useEffect(() => subscribe(onUserLayoutChanged), [subscribe]);
}

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, Math.round(px)));
}

function readSidebarWidth(): number {
  const n = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_PX;
}

function writeSidebarWidth(px: number): void {
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
}

export function ShellGroup({
  hasContentPanel,
  children,
}: {
  hasContentPanel: boolean;
  children: ReactNode;
}): ReactNode {
  const panelIds = useMemo(
    () => [PANEL_IDS.main, ...(hasContentPanel ? [PANEL_IDS.content] : [])],
    [hasContentPanel],
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: SHELL_LAYOUT_ID,
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
        className="flex min-h-0 min-w-0 flex-1"
        defaultLayout={defaultLayout}
        resizeTargetMinimumSize={{ coarse: 28, fine: 18 }}
        onLayoutChanged={(layout, meta) => {
          notifyUserLayoutListeners(meta, userLayoutListeners.current);
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

const SHELL_GUTTER_CLASS =
  "relative bg-transparent [-webkit-app-region:no-drag] md:my-1 w-1 after:via-border after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-linear-to-b after:from-transparent after:to-transparent after:opacity-0 after:transition-[opacity,width] hover:after:via-foreground/20 hover:after:opacity-100";

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
        SHELL_GUTTER_CLASS,
        joined && "bg-border w-px",
        "data-[separator=focus]:after:via-foreground/20 data-[separator=active]:after:via-foreground/30 data-[separator=active]:after:w-0.5 data-[separator=active]:after:opacity-100 data-[separator=focus]:after:opacity-100",
        disabled && "w-0 after:hidden",
        locked && "pointer-events-none",
        className,
      )}
      disabled={disabled === true || locked}
      {...props}
    />
  );
}

/** Binds app-owned collapsed state to the panel's imperative state. */
function useCollapsedBinding(
  panelRef: RefObject<PanelImperativeHandle | null>,
  collapsed: boolean,
  onCollapsedChange: ((collapsed: boolean) => void) | undefined,
  expandedSize: number | string,
): NonNullable<OnPanelResize> {
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
    if (panel === null || !laidOut.current) return;
    sync(panel);
  }, [collapsed, panelRef, sync]);

  return (size) => {
    const panel = panelRef.current;
    if (laidOut.current) {
      const isCollapsed = size.inPixels === 0;
      if (isCollapsed !== collapsed) onCollapsedChange?.(isCollapsed);
      return;
    }
    laidOut.current = true;
    if (panel !== null) sync(panel);
  };
}

export function ShellSidebarPanel({
  children,
  separatorDisabled = false,
}: {
  children: ReactNode;
  separatorDisabled?: boolean;
}): ReactNode {
  const { open } = useSidebar();
  const reduceMotion = useReducedMotion() === true;
  const [expanded, setExpanded] = useState(readSidebarWidth);
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
    const next = clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    expandedRef.current = next;
    setExpanded(next);
    columnWidth.jump(next);
  };
  const onPointerUp = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    writeSidebarWidth(expandedRef.current);
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

export function ShellContentPanel({
  children,
  collapsed = false,
  locked = false,
  onSizeChange,
  size,
}: {
  children: ReactNode;
  collapsed?: boolean;
  /** Skip size apply/save while the column is filling leftover space. */
  locked?: boolean;
  onSizeChange?: (width: number) => void;
  size?: number;
}): ReactNode {
  const panelRef = usePanelRef();
  const expandedSize = size ?? CONTENT_DEFAULT_SIZE;
  const onResize = useCollapsedBinding(panelRef, collapsed, undefined, expandedSize);

  useLayoutEffect(() => {
    if (collapsed || locked) return undefined;
    const frame = requestAnimationFrame(() => panelRef.current?.resize(expandedSize));
    return () => cancelAnimationFrame(frame);
  }, [collapsed, expandedSize, locked, panelRef]);

  useUserLayoutChanged(() => {
    if (collapsed || locked) return;
    const width = panelRef.current?.getSize().inPixels;
    if (width !== undefined && width > 0) onSizeChange?.(width);
  });

  return (
    <>
      <ShellSeparator disabled={collapsed} joined />
      <ResizablePanel
        className="flex min-w-0 flex-col md:py-1 md:pe-1"
        collapsedSize={0}
        collapsible
        defaultSize={collapsed ? 0 : expandedSize}
        groupResizeBehavior="preserve-pixel-size"
        id={PANEL_IDS.content}
        inert={collapsed}
        minSize={collapsed ? 0 : CONTENT_MIN_SIZE}
        onResize={onResize}
        panelRef={panelRef}
      >
        {children}
      </ResizablePanel>
    </>
  );
}
