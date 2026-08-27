import type { SessionRef } from "@getpie/contract";
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
import { Clock, SquarePen } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/layout/brand-mark";
import { SHELL_TITLEBAR_HEADER_CLASS } from "@/components/layout/shell-chrome";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { ProjectList } from "@/features/projects/project-list";
import { usePlatform } from "@/platform-context";
import { isDesktopHost, isDesktopMacosHost } from "@/platform-host";

export function AppSidebar({
  isSessionActive,
  onNewChat,
  onAutomations,
  automationsActive,
}: {
  readonly isSessionActive: (ref: SessionRef) => boolean;
  readonly onNewChat: () => void;
  readonly onAutomations: () => void;
  readonly automationsActive: boolean;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const platform = usePlatform();
  const desktop = isDesktopHost(platform);
  const { isMobile, state } = useSidebar();
  const expanded = !isMobile && state === "expanded";
  // Web: always (offcanvas on mobile). Desktop: spacer row while expanded so
  // content clears the viewport-fixed toggle; collapsed panel width is 0.
  const showHeader = desktop ? expanded : true;

  return (
    <Sidebar
      variant="inset"
      // The panel group owns desktop width; mobile remains an overlay sheet.
      collapsible={isMobile ? "offcanvas" : "none"}
      className="w-full [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:mx-0"
    >
      {showHeader ? (
        <SidebarHeader
          className={cn(
            SHELL_TITLEBAR_HEADER_CLASS,
            desktop && "px-0",
            "[-webkit-app-region:drag]",
          )}
        >
          {isDesktopMacosHost(platform) ? null : (
            <BrandMark className={desktop ? "ms-[var(--shell-sidebar-brand-inset)]" : undefined} />
          )}
          {!desktop && expanded ? (
            <SidebarTrigger className="[-webkit-app-region:no-drag]" />
          ) : null}
        </SidebarHeader>
      ) : null}

      <SidebarContent className="[-webkit-app-region:no-drag]">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onNewChat}>
                  <SquarePen />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={automationsActive} onClick={onAutomations}>
                  <Clock />
                  <span>Automations</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <ProjectList isSessionActive={isSessionActive} onImport={() => setImportOpen(true)} />
      </SidebarContent>

      {importOpen && <ImportProjectDialog onClose={() => setImportOpen(false)} />}
    </Sidebar>
  );
}
