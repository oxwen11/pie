import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, useMatch } from "@tanstack/react-router";

import {
  AppShell,
  AppShellBody,
  AppShellMain,
  AppShellSidebar,
} from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CardPanel } from "@/components/layout/card-panel";
import { browserPanel } from "@/components/layout/content-panel/panels/browser-panel";
import { terminalPanel } from "@/components/layout/content-panel/panels/terminal-panel";
import { ContentPanelSessionProvider } from "@/components/layout/content-panel/react/session-provider";
import { contentPanel } from "@/content-panel";
import { filePanel } from "@/features/files/file-panel";
import { filesPanel } from "@/features/files/files-panel";
import { useProjectSessionTitle } from "@/features/projects/use-project-sessions";
import { useProject } from "@/features/projects/use-projects";
import { useSessionListSync } from "@/features/projects/use-session-list-sync";
import { pullRequestPanel } from "@/features/pull-request/pull-request-panel";
import { reviewPanel } from "@/features/review/review-panel";
import type { AppClients } from "@/lib/orpc";

export interface RouterAppContext {
  orpcClient: AppClients["orpcClient"];
  orpcQueryUtils: AppClients["orpcQueryUtils"];
  queryClient: QueryClient;
}

contentPanel.registerAll([
  filesPanel,
  filePanel,
  reviewPanel,
  pullRequestPanel,
  terminalPanel,
  browserPanel,
]);

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootLayout,
});

// Global shell: left sidebar + floating card panel; every route renders in the card.
function RootLayout() {
  // Keeps every `session.list` cache converged from the server's events
  // (multi-tab / desktop), independent of which route is mounted.
  useSessionListSync();

  // This is the shell's one route-identity seam for the card: the content
  // panel and heading derive from the same authoritative session-route ref.
  // Sidebar modules read the route themselves and jump without callbacks.
  //
  // A named match, not `useParams({ strict: false })`: this component *is* the
  // root route's, so the nearest match is always the root — which has no params
  // — and the session route's would never be seen. The match's loaderData is
  // also the ref the server confirmed, unlike the URL's search hints. Off a
  // session route it is null and every panel hook degrades to a no-op.
  const sessionRoute =
    useMatch({
      from: "/session/$sessionId",
      shouldThrow: false,
    }) ?? null;
  const sessionRef = sessionRoute?.loaderData?.ref ?? null;
  const draftProjectId = useMatch({
    from: "/draft",
    shouldThrow: false,
    select: (match) => match.search.projectId ?? null,
  });
  const schedulesRoute =
    useMatch({
      from: "/schedules",
      shouldThrow: false,
    }) ?? null;
  const pullRequestsRoute =
    useMatch({
      from: "/pull-requests",
      shouldThrow: false,
    }) ?? null;
  const project = useProject(sessionRef?.projectId ?? draftProjectId);
  const sessionTitle = useProjectSessionTitle(sessionRef ?? undefined);

  return (
    <AppShell>
      <ContentPanelSessionProvider contentPanel={contentPanel} sessionRef={sessionRef}>
        <AppShellBody>
          <AppShellSidebar>
            <AppSidebar />
          </AppShellSidebar>
          <AppShellMain>
            <CardPanel
              heading={
                pullRequestsRoute !== null
                  ? undefined
                  : schedulesRoute !== null
                    ? "Schedule"
                    : sessionRef === null
                      ? "New chat"
                      : (sessionTitle ?? "New chat")
              }
              supportingText={
                pullRequestsRoute !== null || schedulesRoute !== null ? undefined : project?.name
              }
            />
          </AppShellMain>
        </AppShellBody>
      </ContentPanelSessionProvider>
    </AppShell>
  );
}
