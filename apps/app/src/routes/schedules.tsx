import { createFileRoute } from "@tanstack/react-router";

import { useProjects } from "@/features/projects/use-projects";
import { SchedulePage } from "@/features/schedules/schedule-page";

export const Route = createFileRoute("/schedules")({
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const projects = useProjects();
  return <SchedulePage projects={projects.data ?? []} projectsReady={projects.isSuccess} />;
}
