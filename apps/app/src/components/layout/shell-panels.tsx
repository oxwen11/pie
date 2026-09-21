import { cn } from "@getpie/ui/lib/utils";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  Group,
  type LayoutChangedMeta,
  type OnPanelResize,
  type PanelImperativeHandle,
  Separator,
  type SeparatorProps,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";

/** Chat | content-panel columns. */

const SHELL_LAYOUT_ID = "pie:shell-layout";
const CONTENT_DEFAULT_SIZE = "28rem";
const CONTENT_MIN_SIZE = "18rem";

const PANEL_IDS = {
  content: "content",
  main: "main",
} as const;

export type UserLayoutListener = () => void;

export function notifyUserLayoutListeners(
  meta: LayoutChangedMeta,
  listeners: ReadonlySet<UserLayoutListener>,
): void {
  if (!meta.isUserInteraction) return;
  for (const listener of listeners) listener();
}

type SubscribeToUserLayout = (listener: UserLayoutListener) => () => void;

const ShellLayoutContext = createContext<SubscribeToUserLayout | null>(null);

function useUserLayoutChanged(listener: UserLayoutListener): void {
  const subscribe = use(ShellLayoutContext);
  if (subscribe === null) throw new Error("Shell panels must be rendered inside ShellGroup");
  const onUserLayoutChanged = useEffectEvent(listener);
  useEffect(() => subscribe(onUserLayoutChanged), [subscribe]);
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

export const SHELL_GUTTER_CLASS =
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
