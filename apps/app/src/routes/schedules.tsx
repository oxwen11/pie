import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useProjects } from "@/features/projects/use-projects";
import { SchedulePage } from "@/features/schedules/schedule-page";

type SchedulesSearch = {
  readonly create?: true;
  readonly projectId?: string;
  readonly sessionId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends keyof SchedulesSearch>(
  key: K,
  value: SchedulesSearch[K],
): Pick<SchedulesSearch, K> | undefined =>
  value === undefined ? undefined : ({ [key]: value } as Pick<SchedulesSearch, K>);

export const Route = createFileRoute("/schedules")({
  validateSearch: (search: Record<string, unknown>): SchedulesSearch => ({
    ...optional("create", search.create === true || search.create === "true" ? true : undefined),
    ...optional("projectId", asText(search.projectId)),
    ...optional("sessionId", asText(search.sessionId)),
  }),
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const projects = useProjects();
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <SchedulePage
      createDefaults={{ projectId: search.projectId, sessionId: search.sessionId }}
      createOpen={search.create === true}
      onCloseCreate={() => {
        navigate({ to: "/schedules", search: {}, replace: true }).catch((error: unknown) => {
          console.error("Failed to close the schedule editor", error);
        });
      }}
      onOpenCreate={() => {
        navigate({ to: "/schedules", search: { create: true } }).catch((error: unknown) => {
          console.error("Failed to open the schedule editor", error);
        });
      }}
      projects={projects.data ?? []}
      projectsReady={projects.isSuccess}
    />
  );
}
