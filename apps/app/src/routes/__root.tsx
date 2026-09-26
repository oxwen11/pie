import { createRootRouteWithContext, useMatch, useRouteContext } from "@tanstack/react-router";

import {
  AppShell,
  AppShellBody,
  AppShellMain,
  AppShellSessionPanel,
  AppShellSidebar,
} from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CardPanel } from "@/components/layout/card-panel";
import { browserPanel } from "@/components/layout/content-panel/panels/browser-panel";
import { ContentPanelSessionProvider } from "@/components/layout/content-panel/react/session-provider";
import { PullRequestDemandProvider } from "@/components/layout/pull-request-demand-provider";
import { contentPanel } from "@/content-panel";
import { filePanel } from "@/features/files/file-panel";
import { filesPanel } from "@/features/files/files-panel";
import { pullRequestPanel } from "@/features/pull-request/pull-request-panel";
import { reviewPanel } from "@/features/review/review-panel";
import { EnvironmentOrpcProvider } from "@/lib/environment-orpc";
import type { EnvironmentRpc } from "@/lib/environment-rpc";

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
  // panel derives from the authoritative session-route ref. Page headings
  // belong to the route that renders them.
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
    }),
  });
  const { environmentRpc, localEnvironmentId } = useRouteContext({ from: "__root__" });
  const environmentId = sessionRef?.environmentId ?? draft?.environmentId ?? localEnvironmentId;
  return (
    <PullRequestDemandProvider>
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
              <AppShellMain>
                <CardPanel />
              </AppShellMain>
              <AppShellSessionPanel />
            </EnvironmentOrpcProvider>
          </AppShellBody>
        </ContentPanelSessionProvider>
      </AppShell>
    </PullRequestDemandProvider>
  );
}
