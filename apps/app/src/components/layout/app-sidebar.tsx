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
  useSidebar,
} from "@getpie/ui/components/sidebar";
import { Link, useMatch, useRouterState } from "@tanstack/react-router";

import { appNav, type AppNavItem } from "@/components/layout/app-nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { PageSidebarOutlet } from "@/components/layout/page-sidebar";
import { hasPageSidebar } from "@/components/layout/page-sidebar-match";
import { ConnectionSwitcher } from "@/features/connections/connection-switcher";
import { ProjectList } from "@/features/projects/project-list";
import { RecentList } from "@/features/projects/recent-list";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

function AppNavMenuItem({ item }: { readonly item: AppNavItem }) {
  const { icon: Icon, label, search, to } = item;
  const active = useMatch({ from: to, shouldThrow: false }) !== undefined;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} render={<Link search={search} to={to} />}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const platform = usePlatform();
  const desktop = isDesktopHost(platform);
  const { isMobile } = useSidebar();
  const pageSidebar = useRouterState({
    select: ({ matches }) => hasPageSidebar(matches),
  });

  return (
    <Sidebar
      variant="sidebar"
      // The panel group owns desktop width; mobile remains an overlay sheet.
      collapsible={isMobile ? "offcanvas" : "none"}
      className="bg-card w-full! [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:mx-0"
    >
      <div className="bg-card flex h-full min-h-0 w-full flex-col">
        {pageSidebar ? null : (
          <SidebarHeader className="p-0">
            {/* Desktop: the title row shows traffic lights, so the list carries
                the mark. Web hosts it in the title row instead. */}
            {desktop ? (
              <div className="flex h-10 shrink-0 flex-row items-center gap-2 px-4">
                <BrandMark />
              </div>
            ) : null}
            <SidebarMenu className="px-2 pb-1">
              <AppNavMenuItem item={appNav.home} />
            </SidebarMenu>
          </SidebarHeader>
        )}

        <SidebarGroup className="shrink-0 pt-0 md:hidden">
          <SidebarGroupContent>
            <SidebarMenu>
              {pageSidebar ? <AppNavMenuItem item={appNav.home} /> : null}
              {appNav.sections.map((item) => (
                <AppNavMenuItem key={item.to} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {pageSidebar ? (
          <PageSidebarOutlet />
        ) : (
          <SidebarContent>
            <RecentList />
            <ProjectList />
          </SidebarContent>
        )}

        <SidebarFooter className="[-webkit-app-region:no-drag]">
          {platform.ssh ? <ConnectionSwitcher /> : null}
          <SidebarMenu className="md:hidden">
            <AppNavMenuItem item={appNav.footer} />
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
