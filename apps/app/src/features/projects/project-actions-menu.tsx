import type { Project } from "@getpie/contract";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@getpie/ui/components/menu";
import { SidebarGroupAction } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis, SquarePen, Trash2 } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { RemoveProjectDialog } from "@/features/projects/remove-project-dialog";

export interface ProjectActionsMenuProps extends ComponentProps<"div"> {
  /** Called after the Project is removed from the server registry. */
  readonly onRemoved: (projectId: string) => void;
  /** The Project whose actions this menu controls. */
  readonly project: Project;
}

export function ProjectActionsMenu({
  className,
  onRemoved,
  project,
  ...props
}: ProjectActionsMenuProps) {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);

  return (
    <div className={cn("contents", className)} {...props}>
      <Menu>
        <MenuTrigger
          render={
            <SidebarGroupAction
              aria-label={`Actions for ${project.name}`}
              className="top-1 right-1 after:-inset-3 md:after:block"
            />
          }
        >
          <Ellipsis />
        </MenuTrigger>
        <MenuPopup align="start" side="right">
          <MenuItem onClick={() => navigate({ to: "/draft", search: { projectId: project.id } })}>
            <SquarePen />
            New chat
          </MenuItem>
          <MenuItem onClick={() => setRemoving(true)} variant="destructive">
            <Trash2 />
            Remove project
          </MenuItem>
        </MenuPopup>
      </Menu>
      {removing ? (
        <RemoveProjectDialog
          onClose={() => setRemoving(false)}
          onRemoved={onRemoved}
          project={project}
        />
      ) : null}
    </div>
  );
}
