import { createFileRoute } from "@tanstack/react-router";

import { PullRequestPage } from "@/features/pull-request/pull-request-page";

export const Route = createFileRoute("/pull-requests")({
  staticData: { cardHeading: false },
  component: PullRequestPage,
});
