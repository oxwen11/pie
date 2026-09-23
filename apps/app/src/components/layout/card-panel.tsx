import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";

import { BrandMark } from "@/components/layout/brand-mark";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { SHELL_TITLEBAR_HEADER_CLASS } from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

/** Shell chrome only. Page titles live in the route that needs them. */
export function CardPanel() {
  const { state, isMobile } = useSidebar();
  const hasContentPanelToggle = useContentPanel() !== null;
  const desktop = isDesktopHost(usePlatform());
  const collapsedDesktop = !isMobile && state === "collapsed";
  const webCollapsedChrome = collapsedDesktop && !desktop;
  // Mobile keeps the sidebar trigger, collapsed web keeps the brand mark, and
  // desktop keeps the frameless window drag region. Web expanded needs none.
  const showHeader = isMobile || webCollapsedChrome || desktop;

  return (
    <SidebarInset
      className={cn(
        "bg-card flex min-h-0 flex-col overflow-hidden border border-black/10 md:rounded-2xl md:shadow-[-4px_0_12px_-8px_--theme(--color-black/10%)] dark:border-white/8",
        // Drop the top border when collapsed so the card header lines up with
        // the viewport-fixed titlebar row.
        collapsedDesktop && desktop && "border-t-0",
      )}
    >
      {showHeader ? (
        <CardPanelHeader
          collapsedDesktop={collapsedDesktop}
          desktop={desktop}
          hasContentPanelToggle={hasContentPanelToggle}
          isMobile={isMobile}
          webCollapsedChrome={webCollapsedChrome}
        />
      ) : null}
      {/*
       * Always the Outlet, never a router-state-driven swap: `isLoading` flips
       * on *every* navigation, including a same-route search-param change like
       * /draft?projectId=…, and swapping the Outlet out unmounts the active
       * route — which would dispose the draft composer's editor and drop
       * whatever the user had typed. Slow route loaders are already covered by
       * the router's own `defaultPendingComponent` (see router.tsx).
       */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </SidebarInset>
  );
}

function CardPanelHeader({
  collapsedDesktop,
  desktop,
  hasContentPanelToggle,
  isMobile,
  webCollapsedChrome,
}: {
  collapsedDesktop: boolean;
  desktop: boolean;
  hasContentPanelToggle: boolean;
  isMobile: boolean;
  webCollapsedChrome: boolean;
}) {
  return (
    <header
      className={cn(
        SHELL_TITLEBAR_HEADER_CLASS,
        desktop && collapsedDesktop && "ps-(--shell-titlebar-content-left)",
      )}
      data-drag-region=""
    >
      <div className="flex min-w-0 flex-1 items-center">
        {isMobile ? (
          <SidebarTrigger className="-ms-0.5 me-2" />
        ) : webCollapsedChrome ? (
          <div className="me-2 flex items-center">
            <BrandMark className="shrink-0" />
            <SidebarTrigger className="-ms-px ms-2 shrink-0 -translate-y-px" />
          </div>
        ) : null}
      </div>
      {hasContentPanelToggle ? (
        <div aria-hidden="true" className="ms-auto size-7 shrink-0" />
      ) : null}
    </header>
  );
}
