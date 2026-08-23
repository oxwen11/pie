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
import { SquarePen } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/layout/brand-mark";
import {
  desktopSidebarBrandInsetClass,
  SHELL_TITLEBAR_HEADER_CLASS,
} from "@/components/layout/shell-chrome";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { ProjectList } from "@/features/projects/project-list";
import { usePlatform } from "@/platform-context";
import { useHostLayout } from "@/use-host-layout";

export function AppSidebar({
  isSessionActive,
  onNewChat,
}: {
  readonly isSessionActive: (ref: SessionRef) => boolean;
  readonly onNewChat: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const platform = usePlatform();
  const { showsDesktopTitlebarHeader, showsInlineSidebarToggle, showsSidebarBrandMark } =
    useHostLayout();
  const { isMobile, state } = useSidebar();
  const showsWebHeader =
    !showsDesktopTitlebarHeader &&
    (showsSidebarBrandMark || (!isMobile && state === "expanded" && showsInlineSidebarToggle));
  const showsSidebarHeader =
    showsWebHeader || (showsDesktopTitlebarHeader && !isMobile && state === "expanded");

  return (
    <Sidebar
      variant="inset"
      // The panel group owns desktop width; mobile remains an overlay sheet.
      collapsible={isMobile ? "offcanvas" : "none"}
      className="w-full [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:mx-0"
    >
      {showsSidebarHeader ? (
        <SidebarHeader
          className={cn(
            SHELL_TITLEBAR_HEADER_CLASS,
            showsDesktopTitlebarHeader ? "px-0" : undefined,
            "[-webkit-app-region:drag]",
          )}
        >
          {showsSidebarBrandMark ? (
            <BrandMark
              className={cn(showsDesktopTitlebarHeader && desktopSidebarBrandInsetClass(platform))}
            />
          ) : null}
          {showsWebHeader && !isMobile && state === "expanded" && showsInlineSidebarToggle ? (
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <ProjectList isSessionActive={isSessionActive} onImport={() => setImportOpen(true)} />
      </SidebarContent>

      {importOpen && <ImportProjectDialog onClose={() => setImportOpen(false)} />}
    </Sidebar>
  );
}
