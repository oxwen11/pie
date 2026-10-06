import { SidebarProvider, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { LazyMotion, domMax } from "motion/react";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AppRail } from "@/components/layout/app-rail";
import { BrandMark } from "@/components/layout/brand-mark";
import { useContentPanel, usePanelSnapshot } from "@/components/layout/content-panel/react/hooks";
import { ContentPanelOutlet } from "@/components/layout/content-panel/react/outlet";
import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";
import { ShellContentPanel } from "@/components/layout/shell-content";
import { ShellSidebarPanel } from "@/components/layout/shell-sidebar";
import { ShellSidebarToggle } from "@/components/layout/shell-sidebar-toggle";
import { usePlatform } from "@/platform-context";
import { isDesktopMacosHost } from "@/platform-host";

interface AppShellContextValue {
  readonly contentPanel: {
    /** Whether the session-bound content-panel column is mounted. */
    readonly visible: boolean;
    /** Whether the content panel fills the shell and collapses the main column. */
    readonly maximized: boolean;
    /** Switch the content panel between maximized and docked presentation. */
    readonly setMaximized: (maximized: boolean) => void;
    /** Titlebar slot above the content-panel column; hosts its tab strip. */
    readonly titleTarget: HTMLDivElement | null;
  };
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

const ShellTitleContext = createContext<HTMLDivElement | null>(null);

/** Route-owned title, placed in the window titlebar at the main column. */
export function ShellTitle({ children }: { readonly children: ReactNode }): ReactNode {
  const target = use(ShellTitleContext);
  return target === null ? null : createPortal(children, target);
}

const useAppShell = (): AppShellContextValue => {
  const value = use(AppShellContext);
  if (value === null) {
    throw new Error("AppShellSidebar and AppShellMain must be rendered inside AppShellBody");
  }
  return value;
};

export interface AppShellSidebarProps {
  readonly children: ReactNode;
}

export function AppShellSidebar({ children }: AppShellSidebarProps) {
  const { isMobile } = useSidebar();
  const { contentPanel } = useAppShell();
  if (isMobile) return children;
  return (
    <ShellSidebarPanel separatorDisabled={contentPanel.maximized}>{children}</ShellSidebarPanel>
  );
}

export interface AppShellMainProps {
  readonly children: ReactNode;
}

export function AppShellMain({ children }: AppShellMainProps) {
  const { contentPanel } = useAppShell();
  const fill = contentPanel.maximized;
  return (
    <div className={cn("flex min-h-0 flex-col", fill ? "w-0 overflow-hidden" : "min-w-80 flex-1")}>
      {children}
    </div>
  );
}

/** Restore the state persisted by SidebarProvider. */
const readSidebarCookie = (): boolean => !document.cookie.includes("sidebar_state=false");

/** Structural shell only; the root composition owns the semantic surfaces. */
export interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    // The provider is shell-owned: it supplies responsive/sidebar state and is
    // also the viewport wrapper. The shell titlebar is the window drag strip;
    // h-svh keeps long transcripts scrolling inside the shell.
    <SidebarProvider className="bg-sidebar h-svh overflow-hidden" defaultOpen={readSidebarCookie()}>
      <LazyMotion features={domMax}>{children}</LazyMotion>
    </SidebarProvider>
  );
}

export interface AppShellBodyProps {
  readonly children: ReactNode;
}

export function AppShellBody({ children }: AppShellBodyProps) {
  const session = useContentPanel();
  const presentation = usePanelSnapshot((snapshot) => snapshot.presentation);
  const hasVisibleContentPanel = presentation !== "hidden" && session !== null;
  const isContentPanelMaximized = presentation === "maximized";
  const setContentPanelMaximized = useCallback(
    (maximized: boolean) => session?.setPresentation(maximized ? "maximized" : "docked"),
    [session],
  );
  const [contentTitleTarget, setContentTitleTarget] = useState<HTMLDivElement | null>(null);
  const context = useMemo(
    () => ({
      contentPanel: {
        visible: hasVisibleContentPanel,
        maximized: isContentPanelMaximized,
        setMaximized: setContentPanelMaximized,
        titleTarget: contentTitleTarget,
      },
    }),
    [hasVisibleContentPanel, isContentPanelMaximized, setContentPanelMaximized, contentTitleTarget],
  );

  const platform = usePlatform();
  const macos = isDesktopMacosHost(platform);
  const { isMobile } = useSidebar();
  const [titleTarget, setTitleTarget] = useState<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const measure = useCallback((shell: HTMLDivElement) => {
    const left = shell.getBoundingClientRect().left;
    const toggle = shell.querySelector<HTMLElement>("[aria-label='Toggle Sidebar']");
    if (toggle !== null) {
      const leading = toggle.getBoundingClientRect().right - left + 8;
      shell.style.setProperty("--shell-leading", `${leading}px`);
    }
    // The content slot spans the panel column up to the trailing toggle.
    const column = shell.querySelector<HTMLElement>("[data-slot=content-panel-column]");
    const trailing = shell.querySelector<HTMLElement>("[aria-label='Toggle content panel']");
    const start = column?.getBoundingClientRect().left ?? 0;
    const width =
      column === null || trailing === null
        ? 0
        : Math.max(0, trailing.getBoundingClientRect().left - 8 - start);
    shell.style.setProperty("--shell-content-left", `${start - left}px`);
    shell.style.setProperty("--shell-content-width", `${width}px`);
    shell.style.setProperty("--shell-content-reserve", width > 0 ? `${width + 8}px` : "0px");
  }, []);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return undefined;
    const run = () => measure(shell);
    run();
    shell.style.setProperty("--shell-rail", isMobile ? "0px" : "3.25rem");
    const observer = new ResizeObserver(run);
    observer.observe(shell);
    const column = shell.querySelector("[data-slot=content-panel-column]");
    if (column !== null) observer.observe(column);
    return () => observer.disconnect();
  }, [isMobile, measure]);
  return (
    <AppShellContext value={context}>
      <ShellTitleContext value={titleTarget}>
        <div className="flex min-h-0 w-full flex-1 flex-col" data-slot="shell" ref={shellRef}>
          {/* One drag strip. Its split tracks the sidebar width, so resizing the
              list moves the title. Routes portal a title into the main column. */}
          <header
            className={cn(
              "group relative flex shrink-0 items-center gap-2 pe-4",
              !macos && "h-10 ps-2",
            )}
            data-drag-region=""
            style={
              macos
                ? {
                    height: platform.windowChrome.titlebarHeight,
                    paddingInlineStart: platform.windowChrome.toggleInset,
                  }
                : undefined
            }
          >
            {macos ? null : <BrandMark />}
            <ShellSidebarToggle />
            <div
              aria-hidden="true"
              className="bg-border pointer-events-none absolute top-1/2 hidden h-5 w-px -translate-y-1/2 group-has-[[data-app-shell-titlebar-content]]:block"
              style={{
                left: "calc(var(--shell-rail, 0px) + var(--shell-sidebar-width, 0px))",
                opacity: "var(--shell-sidebar-rule, 0)",
              }}
            />
            <div
              className={cn(
                "flex h-full min-w-0 flex-1 items-center",
                isContentPanelMaximized && "hidden",
              )}
              data-slot="shell-title"
              ref={setTitleTarget}
              style={{
                marginInlineStart:
                  "max(0px, calc(var(--shell-rail, 0px) + var(--shell-sidebar-width, 0px) + var(--shell-gutter, 0px) + 8px - var(--shell-leading, 0px)))",
                marginInlineEnd: "var(--shell-content-reserve, 0px)",
              }}
            />
            <div
              className={cn(
                // The rule continues the panel's column divider into the titlebar.
                "before:bg-border absolute inset-y-0 flex min-w-0 items-center before:absolute before:top-1/2 before:-left-px before:h-5 before:w-px before:-translate-y-1/2",
                !hasVisibleContentPanel && "hidden",
                isContentPanelMaximized && "before:hidden",
              )}
              data-slot="shell-content-title"
              ref={setContentTitleTarget}
              style={{
                left: "var(--shell-content-left, 0px)",
                width: "var(--shell-content-width, 0px)",
              }}
            />
            <ContentPanelToggle className="ms-auto" />
          </header>
          <div className={cn("flex min-h-0 w-full flex-1 md:py-1 md:pe-1", macos && "md:pt-0")}>
            <AppRail />
            {/* One persistent border encloses the session list, main and content
                panel. Collapsing a column never moves or removes this frame. */}
            <div
              className="bg-card flex min-h-0 min-w-0 flex-1 overflow-hidden md:rounded-xl md:border md:border-black/10 md:shadow-[-4px_0_12px_-8px_--theme(--color-black/10%)] dark:md:border-white/8"
              data-slot="shell-panel"
            >
              {children}
            </div>
          </div>
        </div>
      </ShellTitleContext>
    </AppShellContext>
  );
}

/** Session-scoped column beside chat; mount under the same EnvironmentOrpcProvider as Main. */
export function AppShellSessionPanel(): ReactNode {
  const { contentPanel } = useAppShell();
  const sessionKey = useContentPanel()?.sessionKey ?? null;
  return (
    <ShellContentPanel
      collapsed={!contentPanel.visible}
      maximized={contentPanel.maximized}
      sessionKey={sessionKey}
    >
      <ContentPanelOutlet tabStripTarget={contentPanel.titleTarget} />
    </ShellContentPanel>
  );
}
