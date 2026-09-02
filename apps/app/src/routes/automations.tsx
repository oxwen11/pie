import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AutomationPage } from "@/features/automations/automation-page";
import { useProjects } from "@/features/projects/use-projects";

type AutomationsSearch = {
  readonly create?: true;
  readonly projectId?: string;
  readonly sessionId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optional = <K extends keyof AutomationsSearch>(
  key: K,
  value: AutomationsSearch[K],
): Pick<AutomationsSearch, K> | undefined =>
  value === undefined ? undefined : ({ [key]: value } as Pick<AutomationsSearch, K>);

export const Route = createFileRoute("/automations")({
  validateSearch: (search: Record<string, unknown>): AutomationsSearch => ({
    ...optional("create", search.create === true || search.create === "true" ? true : undefined),
    ...optional("projectId", asText(search.projectId)),
    ...optional("sessionId", asText(search.sessionId)),
  }),
  component: AutomationsRoute,
});

function AutomationsRoute() {
  const projects = useProjects();
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AutomationPage
      createDefaults={{ projectId: search.projectId, sessionId: search.sessionId }}
      createOpen={search.create === true}
      onCloseCreate={() => {
        navigate({ to: "/automations", search: {}, replace: true }).catch((error: unknown) => {
          console.error("Failed to close the automation editor", error);
        });
      }}
      onOpenCreate={() => {
        navigate({ to: "/automations", search: { create: true } }).catch((error: unknown) => {
          console.error("Failed to open the automation editor", error);
        });
      }}
      projects={projects.data ?? []}
      projectsReady={projects.isSuccess}
    />
  );
}
