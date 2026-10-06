import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
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
  // macOS drag lives in the shell traffic-light row. This header is only the
  // mobile trigger and the collapsed-web brand.
  const showHeader = isMobile || webCollapsedChrome;

  return (
    <SidebarInset className="bg-card flex min-h-0 flex-col overflow-hidden rounded-none shadow-none">
      {showHeader ? (
        <CardPanelHeader
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
  hasContentPanelToggle,
  isMobile,
  webCollapsedChrome,
}: {
  hasContentPanelToggle: boolean;
  isMobile: boolean;
  webCollapsedChrome: boolean;
}) {
  return (
    <header className={SHELL_TITLEBAR_HEADER_CLASS} data-drag-region="">
      <div className="flex min-w-0 flex-1 items-center">
        {isMobile ? (
          <SidebarTrigger className="-ms-0.5 me-2" />
        ) : webCollapsedChrome ? (
          <BrandMark className="me-2 shrink-0" />
        ) : null}
      </div>
      {hasContentPanelToggle ? (
        <div aria-hidden="true" className="ms-auto size-9 shrink-0" />
      ) : null}
    </header>
  );
}
