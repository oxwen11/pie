import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@getpie/ui/components/sidebar";
import { ChevronRight, FolderPlus } from "lucide-react";
import { useState } from "react";

import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { COLLAPSIBLE_PANEL_MOTION } from "@/features/projects/panel-motion";
import { ProjectSessionsGroup } from "@/features/projects/project-sessions-group";
import { useProjects } from "@/features/projects/use-projects";

/** Every imported project, each rendering its own session list. */
export function ProjectList() {
  const projects = useProjects();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <Collapsible defaultOpen>
        <SidebarGroup>
          <SidebarGroupLabel
            className="text-sidebar-foreground/70 tracking-wider"
            render={
              <CollapsibleTrigger className="group/projects-trigger hover:bg-sidebar-accent/70 cursor-pointer gap-1.5 pe-8" />
            }
          >
            <span>Projects</span>
            <ChevronRight className="transition-transform group-data-[panel-open]/projects-trigger:rotate-90" />
          </SidebarGroupLabel>
          <SidebarGroupAction onClick={() => setImportOpen(true)} title="Import project">
            <FolderPlus />
            <span className="sr-only">Import project</span>
          </SidebarGroupAction>
          {/* keepMounted: rebuilding every project's rows on each expand is a long
            task once the sidebar is real-sized — see panel-motion.ts. */}
          <CollapsiblePanel className={COLLAPSIBLE_PANEL_MOTION} keepMounted>
            <SidebarGroupContent className="flex flex-col gap-2">
              {(projects.data ?? []).map((project) => (
                <ProjectSessionsGroup key={project.id} project={project} />
              ))}
            </SidebarGroupContent>
          </CollapsiblePanel>
        </SidebarGroup>
      </Collapsible>
      {importOpen && <ImportProjectDialog onClose={() => setImportOpen(false)} />}
    </>
  );
}
