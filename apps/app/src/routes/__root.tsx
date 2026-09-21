import {
  createRootRouteWithContext,
  useMatch,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";

import {
  AppShell,
  AppShellBody,
  AppShellMain,
  AppShellSessionPanel,
  AppShellSidebar,
  AppShellWorkspace,
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
import { pullRequestPanel } from "@/features/pull-request/pull-request-panel";
import { reviewPanel } from "@/features/review/review-panel";
import { EnvironmentOrpcProvider } from "@/lib/environment-orpc";
import type { EnvironmentRpc } from "@/lib/environment-rpc";
import type { EnvironmentSessionRef } from "@/lib/session-ref";

export interface RouterAppContext {
  localEnvironmentId: string;
  environmentRpc: EnvironmentRpc;
}

contentPanel.registerAll([filesPanel, filePanel, reviewPanel, pullRequestPanel, browserPanel]);

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootLayout,
});

// Global shell: left sidebar + floating card panel; every route renders in the card.
function RootLayout() {
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
          ref: sessionRoute.loaderData.ref,
        };
  const draft = useMatch({
    from: "/draft",
    shouldThrow: false,
    select: (match) => ({
      environmentId: match.search.environmentId,
      projectId: match.search.projectId ?? null,
    }),
  });
  const { environmentRpc, localEnvironmentId } = useRouteContext({ from: "__root__" });
  const environmentId = sessionRef?.environmentId ?? draft?.environmentId ?? localEnvironmentId;
  const projectId = sessionRef?.ref.projectId ?? draft?.projectId;
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
  return (
    <AppShell>
      <ContentPanelSessionProvider contentPanel={contentPanel} sessionRef={sessionRef}>
        {/*
         * One EnvironmentOrpcProvider for chat + content panel. Sidebar stays on the
         * outer local QueryClient above the router.
         */}
        <AppShellBody>
          <AppShellSidebar>
            <AppSidebar />
          </AppShellSidebar>
          <EnvironmentOrpcProvider orpc={environmentRpc.for(environmentId)}>
            <AppShellWorkspace>
              <AppShellMain>
                <EnvironmentCardPanel
                  cardHeader={cardHeader}
                  cardHeading={cardHeading}
                  projectId={projectId}
                  sessionRef={sessionRef}
                />
              </AppShellMain>
              <AppShellSessionPanel />
            </AppShellWorkspace>
          </EnvironmentOrpcProvider>
        </AppShellBody>
      </ContentPanelSessionProvider>
    </AppShell>
  );
}

function EnvironmentCardPanel({
  cardHeader,
  cardHeading,
  projectId,
  sessionRef,
}: {
  cardHeader: false | undefined;
  cardHeading: string | false | undefined;
  projectId: string | null | undefined;
  sessionRef: EnvironmentSessionRef | null;
}) {
  const project = useProject(projectId);
  const sessionTitle = useProjectSessionTitle(sessionRef?.ref);

  return (
    <CardPanel
      heading={
        cardHeading === false
          ? undefined
          : (cardHeading ?? (sessionRef === null ? "New chat" : (sessionTitle ?? "New chat")))
      }
      hideHeader={cardHeader === false}
      supportingText={cardHeading !== undefined ? undefined : project?.name}
    />
  );
}
