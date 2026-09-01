import type { SessionSummary } from "@getpie/contract";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "@getpie/ui/components/context-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";

import { RenameSessionDialog } from "@/features/projects/rename-session-dialog";

/** Session mutations live behind one actions-menu capability boundary. The
 *  menu is a right-click context menu: `render` is the row button element and
 *  children render inside it. */
export function SessionActionsMenu({
  children,
  isActive,
  render,
  session,
}: {
  readonly children: ReactNode;
  readonly isActive: () => boolean;
  readonly render: ReactElement;
  readonly session: SessionSummary;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);

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

      if (archived && isActive()) {
        return Promise.all([
          refreshLists,
          navigate({ to: "/draft", search: { projectId: session.projectId } }),
        ]);
      }

      return refreshLists;
    },
    onError: (error) => toast.error(`Failed to update session: ${error.message}`),
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
        {/* `!` — the vendored popup's not-[class*='w-']:min-w-32 guard
            miscompiles to an always-matching, higher-specificity min-w-32, so a
            plain override can't win. */}
        <ContextMenuPopup className="min-w-48!">
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            disabled={setArchived.isPending}
            onClick={() => setArchived.mutate(!session.archived)}
          >
            {session.archived ? <ArchiveRestore /> : <Archive />}
            {session.archived ? "Restore" : "Archive"}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {/* Mounted only while open so the draft title starts from the current
          title every time, and unmounted before the menu's own exit animation
          has anywhere to put focus back. */}
      {renaming && <RenameSessionDialog onClose={() => setRenaming(false)} session={session} />}
    </>
  );
}
