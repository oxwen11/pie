import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useProjects } from "@/features/projects/use-projects";
import { SchedulePage } from "@/features/schedules/schedule-page";
import { EnvironmentOrpcProvider } from "@/lib/environment-orpc";

type SchedulesSearch = {
  readonly environmentId?: string;
  readonly create?: true;
  readonly projectId?: string;
  readonly sessionId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends keyof SchedulesSearch>(
  key: K,
  value: SchedulesSearch[K],
): Partial<Pick<SchedulesSearch, K>> => {
  const result: Partial<Pick<SchedulesSearch, K>> = {};
  if (value !== undefined) result[key] = value;
  return result;
};

export const Route = createFileRoute("/schedules")({
  validateSearch: (search: Record<string, unknown>): SchedulesSearch => ({
    ...optional("environmentId", asText(search.environmentId)),
    ...optional("create", search.create === true || search.create === "true" ? true : undefined),
    ...optional("projectId", asText(search.projectId)),
    ...optional("sessionId", asText(search.sessionId)),
  }),
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const { environmentRpc, localEnvironmentId } = Route.useRouteContext();
  const search = Route.useSearch();
  const environmentId = search.environmentId ?? localEnvironmentId;
  return (
    <EnvironmentOrpcProvider orpc={environmentRpc.for(environmentId)}>
      <EnvironmentSchedulesRoute environmentId={environmentId} search={search} />
    </EnvironmentOrpcProvider>
  );
}

function EnvironmentSchedulesRoute({
  environmentId,
  search,
}: {
  readonly environmentId: string;
  readonly search: SchedulesSearch;
}) {
  const projects = useProjects();
  const navigate = useNavigate();
  return (
    <SchedulePage
      createDefaults={{ projectId: search.projectId, sessionId: search.sessionId }}
      createOpen={search.create === true}
      environmentId={environmentId}
      onCloseCreate={() => {
        navigate({
          to: "/schedules",
          search: { environmentId },
          replace: true,
        }).catch((error: unknown) => {
          console.error("Failed to close the schedule editor", error);
        });
      }}
      onOpenCreate={() => {
        navigate({
          to: "/schedules",
          search: { create: true, environmentId },
        }).catch((error: unknown) => {
          console.error("Failed to open the schedule editor", error);
        });
      }}
      projects={projects.data ?? []}
      projectsReady={projects.isSuccess}
    />
  );
}
