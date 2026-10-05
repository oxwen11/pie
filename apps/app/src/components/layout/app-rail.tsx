import { Button } from "@getpie/ui/components/button";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@getpie/ui/components/tooltip";
import { Link, useMatch } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

import { appNav, type AppNavItem } from "@/components/layout/app-nav";
import { ShellSidebarToggle } from "@/components/layout/shell-sidebar-toggle";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

/** Icon column that stays while the session list collapses. Lights live in the shell row above. */
export function AppRail(): ReactElement {
  const desktop = isDesktopHost(usePlatform());
  return (
    <TooltipProvider delay={300}>
      <nav
        aria-label="App navigation"
        className="hidden w-13 shrink-0 flex-col items-center gap-2 px-1 pt-2 pb-2 md:flex"
        data-slot="app-rail"
      >
        {!desktop ? (
          <Tooltip>
            <TooltipTrigger render={<ShellSidebarToggle />} />
            <TooltipPopup side="right" sideOffset={8}>
              Toggle sidebar
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <RailLink item={appNav.home} />
        {appNav.sections.map((item) => (
          <RailLink item={item} key={item.to} />
        ))}
        <div className="mt-auto">
          <RailLink item={appNav.footer} />
        </div>
      </nav>
    </TooltipProvider>
  );
}

function RailLink({ item }: { readonly item: AppNavItem }): ReactNode {
  const { icon: Icon, label, search, to } = item;
  const active = useMatch({ from: to, shouldThrow: false }) !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-current={active ? "page" : undefined}
            aria-label={label}
            data-pressed={active ? "" : undefined}
            render={<Link search={search} to={to} />}
            size="icon-lg"
            variant="ghost"
          >
            <Icon />
          </Button>
        }
      />
      <TooltipPopup side="right" sideOffset={8}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}
