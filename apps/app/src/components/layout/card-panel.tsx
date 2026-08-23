import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";

import { desktopTitlebarChromeInsetClass } from "@/components/layout/shell-chrome";
import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";
import { useHostLayout } from "@/use-host-layout";
import { usePlatform } from "@/platform-context";

export interface CardPanelProps {
  readonly heading: string;
  readonly supportingText?: string;
}

export function CardPanel({ heading, supportingText }: CardPanelProps) {
  const { state, isMobile } = useSidebar();
  const platform = usePlatform();
  const { usesFixedSidebarToggle } = useHostLayout();
  const collapsedDesktop = !isMobile && state === "collapsed";
  const ownsToggle = isMobile || (collapsedDesktop && !usesFixedSidebarToggle);

  return (
    <SidebarInset className="flex min-h-0 flex-col overflow-hidden border [-webkit-app-region:no-drag] md:rounded-xl md:shadow-sm/5">
      <header
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 px-4 shadow-[inset_0_-1px_0_var(--color-border)] [-webkit-app-region:drag]",
          collapsedDesktop && usesFixedSidebarToggle && desktopTitlebarChromeInsetClass(platform),
        )}
      >
        {ownsToggle && (
          <SidebarTrigger
            className={cn(isMobile ? "-ms-0.5" : "-ms-2", "[-webkit-app-region:no-drag]")}
          />
        )}
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-medium" title={heading}>
            {heading}
          </span>
          {supportingText !== undefined && (
            <span
              className="text-muted-foreground max-w-[50%] min-w-0 truncate"
              title={supportingText}
            >
              {supportingText}
            </span>
          )}
        </div>
        <ContentPanelToggle className="ms-auto [-webkit-app-region:no-drag]" />
      </header>
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
