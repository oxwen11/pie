import { Button } from "@getpie/ui/components/button";
import { useSidebar } from "@getpie/ui/components/sidebar";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@getpie/ui/components/tooltip";
import { cn } from "@getpie/ui/lib/utils";
import { Link, useMatch } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

import { appNav, type AppNavItem } from "@/components/layout/app-nav";

/** Icon column that stays while the session list collapses. The title row above owns lights, mark, and toggles. */
export function AppRail(): ReactElement {
  // Match the sidebar sheet breakpoint (800px), not Tailwind md (768px).
  const mobile = useSidebar().isMobile;
  return (
    <TooltipProvider delay={300}>
      <nav
        aria-label="App navigation"
        className={cn(
          "w-13 shrink-0 flex-col items-center gap-2 px-1 pt-2 pb-2",
          mobile ? "hidden" : "flex",
        )}
        data-slot="app-rail"
      >
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
