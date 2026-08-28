import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { BrandMark } from "@/components/layout/brand-mark";
import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";
import {
  SHELL_TITLEBAR_HEADER_CLASS,
  SHELL_TITLEBAR_LABEL_CLASS,
} from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

export interface CardPanelProps {
  readonly heading: string;
  readonly supportingText?: string;
}

export function CardPanel({ heading, supportingText }: CardPanelProps) {
  const { state, isMobile } = useSidebar();
  const desktop = isDesktopHost(usePlatform());
  const collapsedDesktop = !isMobile && state === "collapsed";
  const webCollapsedChrome = collapsedDesktop && !desktop;
  const reduceMotion = useReducedMotion() === true;
  const chromeTransition = reduceMotion ? { duration: 0 } : undefined;

  return (
    <SidebarInset
      className={cn(
        "border-border/70 flex min-h-0 flex-col overflow-hidden border [-webkit-app-region:no-drag] md:rounded-xl md:shadow-[0_0_16px_-4px_--theme(--color-black/15%)]",
        // Drop the top border when collapsed so the card header lines up with
        // the viewport-fixed titlebar row.
        collapsedDesktop && desktop && "border-t-0",
      )}
    >
      <motion.header
        className={cn(
          SHELL_TITLEBAR_HEADER_CLASS,
          "shadow-[inset_0_-1px_0_var(--color-border)] [-webkit-app-region:drag]",
          collapsedDesktop && desktop && "ps-[var(--shell-titlebar-content-left)]",
        )}
        layoutRoot
      >
        {isMobile ? (
          <SidebarTrigger className="-ms-0.5 [-webkit-app-region:no-drag]" />
        ) : (
          <AnimatePresence initial={false}>
            {webCollapsedChrome ? (
              <motion.div
                key="web-collapsed-chrome"
                className="flex items-center gap-2 overflow-hidden"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={chromeTransition}
              >
                <BrandMark className="shrink-0" />
                <SidebarTrigger className="-ms-px shrink-0 -translate-y-px [-webkit-app-region:no-drag]" />
              </motion.div>
            ) : null}
          </AnimatePresence>
        )}
        <motion.div
          className={SHELL_TITLEBAR_LABEL_CLASS}
          layout="position"
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
        </motion.div>
        <ContentPanelToggle className="ms-auto [-webkit-app-region:no-drag]" />
      </motion.header>
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
