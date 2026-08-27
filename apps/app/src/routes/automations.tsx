import { createFileRoute } from "@tanstack/react-router";

import { AutomationPage } from "@/features/automations/automation-page";
import { useProjects } from "@/features/projects/use-projects";

export const Route = createFileRoute("/automations")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  const projects = useProjects();
  return <AutomationPage projects={projects.data ?? []} projectsReady={projects.isSuccess} />;
}
