import { Collapsible, CollapsibleTrigger } from "@getpie/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@getpie/ui/components/sidebar";
import { useRouteContext } from "@tanstack/react-router";
import { ChevronRight, FolderPlus } from "lucide-react";
import { useState } from "react";

import { ImportProjectDialog } from "@/features/projects/import-project-dialog";
import { KeepMountedCollapsiblePanel } from "@/features/projects/panel-motion";
import { ProjectSessionsGroup } from "@/features/projects/project-sessions-group";
import { useConnectedEnvironments } from "@/features/projects/use-connected-environments";
import { useProjects } from "@/features/projects/use-projects";
import { EnvironmentOrpcProvider } from "@/lib/environment-orpc";

/** Every imported project across connected Environments. */
export function ProjectList() {
  const { environmentRpc } = useRouteContext({ from: "__root__" });
  const environments = useConnectedEnvironments();
  const [importOpen, setImportOpen] = useState(false);
  const multi = environments.length > 1;

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
            task once the sidebar is real-sized — see panel-motion.tsx. */}
          <KeepMountedCollapsiblePanel>
            <SidebarGroupContent className="flex flex-col gap-3">
              {environments.map((environment) => (
                <EnvironmentOrpcProvider
                  orpc={environmentRpc.for(environment.environmentId)}
                  key={environment.environmentId}
                >
                  <EnvironmentProjects
                    environmentId={environment.environmentId}
                    label={multi ? environment.title : undefined}
                  />
                </EnvironmentOrpcProvider>
              ))}
            </SidebarGroupContent>
          </KeepMountedCollapsiblePanel>
        </SidebarGroup>
      </Collapsible>
      {importOpen ? <ImportProjectDialog onClose={() => setImportOpen(false)} /> : null}
    </>
  );
}

function EnvironmentProjects({
  environmentId,
  label,
}: {
  readonly environmentId: string;
  readonly label?: string;
}) {
  const projects = useProjects();
  return (
    <div className="flex flex-col gap-2">
      {label !== undefined ? (
        <div className="text-sidebar-foreground/60 px-2 text-xs tracking-wide uppercase">
          {label}
        </div>
      ) : null}
      {(projects.data ?? []).map((project) => (
        <ProjectSessionsGroup
          environmentId={environmentId}
          key={`${environmentId}:${project.id}`}
          project={project}
        />
      ))}
    </div>
  );
}
