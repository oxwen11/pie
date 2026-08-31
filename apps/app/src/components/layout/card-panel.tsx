import { SidebarInset, SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Outlet } from "@tanstack/react-router";

import { BrandMark } from "@/components/layout/brand-mark";
import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";
import {
  SHELL_TITLEBAR_HEADER_CLASS,
  SHELL_TITLEBAR_LABEL_CLASS,
} from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

export interface CardPanelStatus {
  readonly label: string;
  readonly tone: "positive" | "warning" | "negative" | "muted" | "accent";
}

export interface CardPanelProps {
  readonly heading: string;
  readonly supportingText?: string;
  readonly status?: CardPanelStatus;
}

const statusClassName = {
  positive: "bg-success/8 text-success-foreground",
  warning: "bg-warning/8 text-warning-foreground",
  negative: "bg-destructive/8 text-destructive-foreground",
  muted: "bg-muted text-muted-foreground",
  accent: "bg-primary/8 text-primary",
} satisfies Record<CardPanelStatus["tone"], string>;

export function CardPanel({ heading, status, supportingText }: CardPanelProps) {
  const { state, isMobile } = useSidebar();
  const desktop = isDesktopHost(usePlatform());
  const collapsedDesktop = !isMobile && state === "collapsed";
  const webCollapsedChrome = collapsedDesktop && !desktop;

  return (
    <SidebarInset
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border [-webkit-app-region:no-drag] md:rounded-xl md:shadow-sm/5",
        // Drop the top border when collapsed so the card header lines up with
        // the viewport-fixed titlebar row.
        collapsedDesktop && desktop && "border-t-0",
      )}
    >
      <header
        className={cn(
          SHELL_TITLEBAR_HEADER_CLASS,
          "shadow-[inset_0_-1px_0_var(--color-border)] [-webkit-app-region:drag]",
          collapsedDesktop && desktop && "ps-[var(--shell-titlebar-content-left)]",
        )}
      >
        {isMobile ? (
          <SidebarTrigger className="-ms-0.5 [-webkit-app-region:no-drag]" />
        ) : webCollapsedChrome ? (
          <>
            <BrandMark />
            <SidebarTrigger className="-ms-px -translate-y-px [-webkit-app-region:no-drag]" />
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
          {status !== undefined && (
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium",
                statusClassName[status.tone],
              )}
              data-tone={status.tone}
            >
              {status.label}
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
