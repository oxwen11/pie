import type { SessionRef } from "@getpie/contract";
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
import { ExternalLink, SquarePen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/layout/brand-mark";
import { SHELL_TITLEBAR_HEADER_CLASS } from "@/components/layout/shell-chrome";
import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { ProjectList } from "@/features/projects/project-list";
import { usePlatform } from "@/platform-context";
import { isDesktopHost, isDesktopMacosHost } from "@/platform-host";

export function AppSidebar({
  isSessionActive,
  onNewChat,
}: {
  readonly isSessionActive: (ref: SessionRef) => boolean;
  readonly onNewChat: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const platform = usePlatform();
  const openInBrowser = platform.openInBrowser;
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

      {openInBrowser ? (
        <SidebarFooter className="[-webkit-app-region:no-drag]">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  void openInBrowser()
                    .then((result) => {
                      if (result.status === "restart-required") {
                        toast.warning("Restart the running Pie daemon to enable browser access.");
                      }
                    })
                    .catch(() => {
                      toast.error("Unable to open Pie in the browser.");
                    });
                }}
              >
                <ExternalLink />
                <span>Open in Browser</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}

      {importOpen && <ImportProjectDialog onClose={() => setImportOpen(false)} />}
    </Sidebar>
  );
}
