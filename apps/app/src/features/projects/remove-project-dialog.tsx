import type { Project } from "@getpie/contract";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@getpie/ui/components/alert-dialog";
import { Button } from "@getpie/ui/components/button";
import { ORPCError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { projectCacheKeys, removeProjectFromCache } from "@/features/projects/project-list-cache";

export interface RemoveProjectDialogProps {
  /** Close the confirmation without removing the Project. */
  readonly onClose: () => void;
  /** Called after the Project is removed from the server registry. */
  readonly onRemoved: (projectId: string) => void;
  /** The Project being confirmed for removal. */
  readonly project: Project;
}

export function RemoveProjectDialog({ onClose, onRemoved, project }: RemoveProjectDialogProps) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const cacheKeys = projectCacheKeys(orpcQueryUtils);
  const remove = useMutation({
    mutationFn: () => orpcQueryUtils.project.remove.call({ projectId: project.id }),
    onSuccess: () => {
      removeProjectFromCache(queryClient, cacheKeys, project.id);
      onRemoved(project.id);
      onClose();
      void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.project.list.key() });
    },
    onError: (error) => {
      if (error instanceof ORPCError && error.code === "CONFLICT") {
        toast.error(
          "Finish or stop sessions that are running or waiting for a response before removing this project.",
        );
        return;
      }
      toast.error(`Failed to remove project: ${error.message}`);
    },
  });

  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {project.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the project and all of its sessions from Pie. Files in
            {` ${project.path}`} and Pi's local JSONL conversation files stay on this computer. If a
            session is running or waiting for your response, finish or stop it first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button disabled={remove.isPending} type="button" variant="outline" />}
          >
            Cancel
          </AlertDialogClose>
          <Button
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            type="button"
            variant="destructive"
          >
            Remove project
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
