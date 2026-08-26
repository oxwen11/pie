import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { Link, useMatch } from "@tanstack/react-router";
import { Clock, SquarePen } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { SHELL_TITLEBAR_HEADER_CLASS } from "@/components/layout/shell-chrome";
import { ConnectionSwitcher } from "@/features/connections/connection-switcher";
import { ProjectList } from "@/features/projects/project-list";
import { usePlatform } from "@/platform-context";
import { isDesktopHost, isDesktopMacosHost } from "@/platform-host";

function NewChatNavItem() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link to="/draft" />}>
        <SquarePen />
        <span>New chat</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SchedulesNavItem() {
  const active =
    useMatch({
      from: "/schedules",
      shouldThrow: false,
    }) !== undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} render={<Link search={{}} to="/schedules" />}>
        <Clock />
        <span>Scheduled</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const platform = usePlatform();
  const desktop = isDesktopHost(platform);
  const { isMobile, state } = useSidebar();
  const expanded = !isMobile && state === "expanded";

  return (
    <Sidebar
      variant="inset"
      // The panel group owns desktop width; mobile remains an overlay sheet.
      collapsible={isMobile ? "offcanvas" : "none"}
      className="w-full [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:mx-0"
    >
      {/* Desktop collapsed panel width is 0, so this spacer can stay mounted. */}
      <SidebarHeader
        className={cn(SHELL_TITLEBAR_HEADER_CLASS, desktop && "px-0", "[-webkit-app-region:drag]")}
      >
        {isDesktopMacosHost(platform) ? null : (
          <BrandMark className={desktop ? "ms-[var(--shell-sidebar-brand-inset)]" : undefined} />
        )}
        {!desktop && expanded ? <SidebarTrigger className="[-webkit-app-region:no-drag]" /> : null}
      </SidebarHeader>

      <SidebarContent className="[-webkit-app-region:no-drag]">
        {platform.ssh ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <ConnectionSwitcher />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NewChatNavItem />
              <SchedulesNavItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <ProjectList />
      </SidebarContent>
    </Sidebar>
  );
}
