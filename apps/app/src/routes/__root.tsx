import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  useMatch,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import { use, useMemo, type ReactNode } from "react";

import {
  AppShell,
  AppShellBody,
  AppShellMain,
  AppShellSidebar,
} from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CardPanel } from "@/components/layout/card-panel";
import { browserPanel } from "@/components/layout/content-panel/panels/browser-panel";
import { ContentPanelSessionProvider } from "@/components/layout/content-panel/react/session-provider";
import { contentPanel } from "@/content-panel";
import { filePanel } from "@/features/files/file-panel";
import { filesPanel } from "@/features/files/files-panel";
import { useProjectSessionTitle } from "@/features/projects/use-project-sessions";
import { useProject } from "@/features/projects/use-projects";
import { useSessionListSync } from "@/features/projects/use-session-list-sync";
import { pullRequestPanel } from "@/features/pull-request/pull-request-panel";
import { reviewPanel } from "@/features/review/review-panel";
import { AppClientsProvider } from "@/lib/app-clients";
import type { AppClients } from "@/lib/orpc";
import type { EnvironmentSessionRef } from "@/lib/session-ref";

export interface RouterAppContext {
  orpcClient: AppClients["orpcClient"];
  orpcQueryUtils: AppClients["orpcQueryUtils"];
  queryClient: QueryClient;
  localEnvironmentId: string;
  clientsFor: (environmentId: string) => Promise<AppClients>;
}

contentPanel.registerAll([filesPanel, filePanel, reviewPanel, pullRequestPanel, browserPanel]);

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
  const sessionRef =
    sessionRoute?.loaderData === undefined
      ? null
      : {
          environmentId: sessionRoute.loaderData.environmentId,
          projectId: sessionRoute.loaderData.ref.projectId,
          sessionId: sessionRoute.loaderData.ref.sessionId,
        };
  const draftProjectId = useMatch({
    from: "/draft",
    shouldThrow: false,
    select: (match) => match.search.projectId ?? null,
  });
  const cardHeading = useRouterState({
    select: (state): string | false | undefined => {
      for (let index = state.matches.length - 1; index >= 0; index -= 1) {
        const heading = state.matches[index]?.staticData.cardHeading;
        if (heading !== undefined) return heading;
      }
      return undefined;
    },
  });
  const cardHeader = useRouterState({
    select: (state): false | undefined => {
      for (let index = state.matches.length - 1; index >= 0; index -= 1) {
        const header = state.matches[index]?.staticData.cardHeader;
        if (header !== undefined) return header;
      }
      return undefined;
    },
  });
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
            <SessionBoundMain sessionRef={sessionRef}>
              <CardPanel
                heading={
                  cardHeading === false
                    ? undefined
                    : (cardHeading ??
                      (sessionRef === null ? "New chat" : (sessionTitle ?? "New chat")))
                }
                hideHeader={cardHeader === false}
                supportingText={cardHeading !== undefined ? undefined : project?.name}
              />
            </SessionBoundMain>
          </AppShellMain>
        </AppShellBody>
      </ContentPanelSessionProvider>
    </AppShell>
  );
}

function SessionBoundMain({
  sessionRef,
  children,
}: {
  sessionRef: EnvironmentSessionRef | null;
  children: ReactNode;
}) {
  const { clientsFor, localEnvironmentId, orpcClient, queryClient, orpcQueryUtils } =
    useRouteContext({ from: "__root__" });
  const targetId =
    sessionRef === null || sessionRef.environmentId === localEnvironmentId
      ? null
      : sessionRef.environmentId;
  const remote = use(
    useMemo(
      () => (targetId === null ? Promise.resolve(undefined) : clientsFor(targetId)),
      [clientsFor, targetId],
    ),
  );
  const clients: AppClients = remote ?? { orpcClient, queryClient, orpcQueryUtils };
  return <AppClientsProvider clients={clients}>{children}</AppClientsProvider>;
}
