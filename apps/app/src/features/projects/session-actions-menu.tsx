import type { SessionSummary } from "@getpie/contract";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "@getpie/ui/components/context-menu";
import { SidebarMenuAction } from "@getpie/ui/components/sidebar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";

import { useCurrentSession } from "@/features/projects/current-session";
import { RenameSessionDialog } from "@/features/projects/rename-session-dialog";

/** Session mutations live behind one actions-menu capability boundary. The
 *  menu is a right-click context menu: `render` is the row button element and
 *  children render inside it. A hover `SidebarMenuAction` archives (or restores)
 *  without opening the menu. */
export function SessionActionsMenu({
  children,
  render,
  session,
}: {
  readonly children: ReactNode;
  readonly render: ReactElement;
  readonly session: SessionSummary;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const isSessionActive = useCurrentSession();

  const setArchived = useMutation({
    mutationFn: (archived: boolean) =>
      orpcQueryUtils.agent.session.archive.call({
        ref: {
          projectId: session.projectId,
          sessionId: session.sessionId,
        },
        archived,
      }),
    onSuccess: (_, archived) => {
      const listKey = (isArchived: boolean) =>
        orpcQueryUtils.agent.session.list.queryOptions({
          input: { projectId: session.projectId, archived: isArchived },
        }).queryKey;
      const refreshLists = Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey(false) }),
        queryClient.invalidateQueries({ queryKey: listKey(true) }),
      ]);

      if (archived && isSessionActive(session)) {
        return Promise.all([
          refreshLists,
          navigate({ to: "/draft", search: { projectId: session.projectId } }),
        ]);
      }

      return refreshLists;
    },
    onError: (error) => toast.error(`Failed to update session: ${error.message}`),
  });

  const archiveLabel = session.archived ? "Restore" : "Archive";
  const ArchiveIcon = session.archived ? ArchiveRestore : Archive;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
        {/* `!` — the vendored popup's not-[class*='w-']:min-w-32 guard
            miscompiles to an always-matching, higher-specificity min-w-32, so a
            plain override can't win. */}
        <ContextMenuPopup align="start" className="min-w-48!">
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            disabled={setArchived.isPending}
            onClick={() => setArchived.mutate(!session.archived)}
          >
            <ArchiveIcon />
            {archiveLabel}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      <SidebarMenuAction
        className="md:group-hover/menu-item:bg-sidebar-accent md:group-focus-within/menu-item:bg-sidebar-accent has-[+[data-sidebar=menu-action]]:right-7"
        disabled={setArchived.isPending}
        onClick={() => setArchived.mutate(!session.archived)}
        showOnHover
        title={archiveLabel}
      >
        <ArchiveIcon />
        <span className="sr-only">{archiveLabel}</span>
      </SidebarMenuAction>
      {/* Mounted only while open so the draft title starts from the current
          title every time, and unmounted before the menu's own exit animation
          has anywhere to put focus back. */}
      {renaming && <RenameSessionDialog onClose={() => setRenaming(false)} session={session} />}
    </>
  );
}
