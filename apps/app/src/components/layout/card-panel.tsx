import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";

import { BrandMark } from "@/components/layout/brand-mark";
import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";
import {
  desktopCollapsedCardInsetClass,
  SHELL_TITLEBAR_HEADER_CLASS,
  SHELL_TITLEBAR_LABEL_CLASS,
} from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { useHostLayout } from "@/use-host-layout";

export interface CardPanelProps {
  readonly heading: string;
  readonly supportingText?: string;
}

export function CardPanel({ heading, supportingText }: CardPanelProps) {
  const { state, isMobile } = useSidebar();
  const platform = usePlatform();
  const { showsSidebarBrandMark, usesFixedSidebarToggle } = useHostLayout();
  const collapsedDesktop = !isMobile && state === "collapsed";
  const ownsWebSidebarChrome = collapsedDesktop && !usesFixedSidebarToggle;
  const ownsToggle = isMobile || ownsWebSidebarChrome;

  return (
    <SidebarInset
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border [-webkit-app-region:no-drag] md:rounded-xl md:shadow-sm/5",
        // Drop the top border when collapsed so the card header lines up with the
        // viewport-fixed titlebar row (toggle ± BrandMark).
        collapsedDesktop && usesFixedSidebarToggle && "border-t-0",
      )}
    >
      <header
        className={cn(
          SHELL_TITLEBAR_HEADER_CLASS,
          "shadow-[inset_0_-1px_0_var(--color-border)] [-webkit-app-region:drag]",
          collapsedDesktop && usesFixedSidebarToggle && desktopCollapsedCardInsetClass(platform),
        )}
      >
        {ownsToggle ? (
          <>
            {ownsWebSidebarChrome && showsSidebarBrandMark ? <BrandMark /> : null}
            <SidebarTrigger
              className={cn(
                isMobile && "-ms-0.5",
                ownsWebSidebarChrome && "-ms-px -translate-y-px",
                "[-webkit-app-region:no-drag]",
              )}
            />
          </>
        ) : null}
        <div className={SHELL_TITLEBAR_LABEL_CLASS}>
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
