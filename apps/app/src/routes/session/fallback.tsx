import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

const FALLBACK_REASONS = ["missing-worktree"] as const;
type FallbackReason = (typeof FALLBACK_REASONS)[number];

type FallbackSearch = {
  readonly sessionId: string;
  readonly projectId: string;
  readonly reason?: FallbackReason;
  readonly branch?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asReason = (value: unknown): FallbackReason | undefined =>
  FALLBACK_REASONS.find((reason) => reason === value);

export const Route = createFileRoute("/session/fallback")({
  staticData: { cardHeading: "Can't open session" },
  validateSearch: (search: Record<string, unknown>): FallbackSearch => {
    const sessionId = asText(search.sessionId) ?? "";
    const projectId = asText(search.projectId) ?? "";
    const reason = asReason(search.reason);
    const branch = asText(search.branch);
    return {
      sessionId,
      projectId,
      ...(reason !== undefined ? { reason } : undefined),
      ...(branch !== undefined ? { branch } : undefined),
    };
  },
  beforeLoad: ({ search }) => {
    if (search.sessionId === "" || search.projectId === "") {
      throw redirect({ to: "/draft" });
    }
  },
  component: FallbackRoute,
});

function FallbackRoute() {
  const search = Route.useSearch();
  if (search.reason === "missing-worktree") {
    return (
      <MissingWorktree
        branch={search.branch}
        projectId={search.projectId}
        sessionId={search.sessionId}
      />
    );
  }
  return <UnknownFallback />;
}

function MissingWorktree({
  sessionId,
  projectId,
  branch,
}: {
  readonly sessionId: string;
  readonly projectId: string;
  readonly branch?: string;
}) {
  const { orpcQueryUtils } = Route.useRouteContext();
  const navigate = useNavigate();
  const restore = useMutation({
    mutationFn: () =>
      orpcQueryUtils.agent.session.restoreWorktree.call({
        ref: { projectId, sessionId },
      }),
    onSuccess: () =>
      navigate({
        to: "/session/$sessionId",
        params: { sessionId },
        search: { projectId },
      }),
    onError: (error) => toast.error(`Failed to restore worktree: ${error.message}`),
  });

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Can't open session</EmptyTitle>
        <EmptyDescription>
          {branch === undefined
            ? "This session's checkout was removed."
            : `This session's checkout was removed. Restore ${branch} to continue.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
          Restore worktree
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function UnknownFallback() {
  const navigate = useNavigate();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Can't open session</EmptyTitle>
        <EmptyDescription>This session can't be opened.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => void navigate({ to: "/draft" })} variant="outline">
          New chat
        </Button>
      </EmptyContent>
    </Empty>
  );
}
