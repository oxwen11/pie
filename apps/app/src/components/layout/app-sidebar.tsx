import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { Clock, GitPullRequestIcon, Puzzle, Settings, SquarePen } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { ConnectionSwitcher } from "@/features/connections/connection-switcher";
import { ProjectList } from "@/features/projects/project-list";
import { RecentList } from "@/features/projects/recent-list";
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

function PullRequestsNavItem() {
  const active =
    useMatch({
      from: "/pull-requests",
      shouldThrow: false,
    }) !== undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} render={<Link to="/pull-requests" />}>
        <GitPullRequestIcon />
        <span>Pull requests</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function PluginsNavItem() {
  const active =
    useMatch({
      from: "/plugins",
      shouldThrow: false,
    }) !== undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} render={<Link to="/plugins" />}>
        <Puzzle />
        <span>Plugins</span>
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

function SettingsNavItem() {
  const active =
    useMatch({
      from: "/settings",
      shouldThrow: false,
    }) !== undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} render={<Link to="/settings" />}>
        <Settings />
        <span>Settings</span>
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
        className={cn(
          // Keep this literal so require-static-classes can validate it.
          "flex h-10 shrink-0 flex-row items-center gap-2 p-0 px-4",
          desktop && "px-0",
        )}
        data-drag-region=""
      >
        {isDesktopMacosHost(platform) ? null : (
          <BrandMark className={desktop ? "ms-[var(--shell-sidebar-brand-inset)]" : undefined} />
        )}
        {!desktop && expanded ? <SidebarTrigger /> : null}
      </SidebarHeader>

      <SidebarContent className="[-webkit-app-region:no-drag]">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NewChatNavItem />
              <SchedulesNavItem />
              <PullRequestsNavItem />
              <PluginsNavItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <RecentList />
        <ProjectList />
      </SidebarContent>

      <SidebarFooter className="[-webkit-app-region:no-drag]">
        {platform.ssh ? <ConnectionSwitcher /> : null}
        <SidebarMenu>
          <SettingsNavItem />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
