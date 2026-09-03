import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import { BrandMark } from "@/components/layout/brand-mark";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import {
  SHELL_TITLEBAR_HEADER_CLASS,
  SHELL_TITLEBAR_LABEL_CLASS,
} from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

export interface CardPanelProps {
  readonly heading?: string;
  readonly supportingText?: string;
}

export function CardPanel({ heading, supportingText }: CardPanelProps) {
  const { state, isMobile } = useSidebar();
  const hasContentPanelToggle = useContentPanel() !== null;
  const desktop = isDesktopHost(usePlatform());
  const collapsedDesktop = !isMobile && state === "collapsed";
  const webCollapsedChrome = collapsedDesktop && !desktop;
  const reduceMotion = useReducedMotion() === true;
  const chromeTransition = reduceMotion ? { duration: 0 } : undefined;
  const showTitle = heading !== undefined;
  const showChrome = isMobile || webCollapsedChrome;
  const showHeader = showTitle || showChrome;

  return (
    <SidebarInset
      className={cn(
        "bg-card flex min-h-0 flex-col overflow-hidden border border-black/10 [-webkit-app-region:no-drag] md:rounded-[16px] md:shadow-[-4px_0_12px_-8px_--theme(--color-black/10%)] dark:border-white/8",
        // Drop the top border when collapsed so the card header lines up with
        // the viewport-fixed titlebar row.
        collapsedDesktop && desktop && "border-t-0",
      )}
    >
      {showHeader ? (
        <header
          className={cn(
            SHELL_TITLEBAR_HEADER_CLASS,
            "[-webkit-app-region:drag]",
            showTitle && "shadow-[inset_0_-1px_0_var(--color-border)]",
            desktop && collapsedDesktop && "ps-[var(--shell-titlebar-content-left)]",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center">
            {isMobile ? (
              <SidebarTrigger className="-ms-0.5 me-2 [-webkit-app-region:no-drag]" />
            ) : webCollapsedChrome ? (
              <div className="me-2 flex items-center">
                <BrandMark className="shrink-0" />
                <SidebarTrigger className="-ms-px ms-2 shrink-0 -translate-y-px [-webkit-app-region:no-drag]" />
              </div>
            ) : null}
            {showTitle ? (
              <m.div
                className={SHELL_TITLEBAR_LABEL_CLASS}
                layout={reduceMotion ? false : "position"}
                transition={chromeTransition}
              >
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
              </m.div>
            ) : null}
          </div>
          {hasContentPanelToggle ? (
            <div aria-hidden="true" className="ms-auto size-7 shrink-0" />
          ) : null}
        </header>
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
