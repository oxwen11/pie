import type { WorktreeMissingErrorData } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const CARD_HEADING = "Can't open session";

type FallbackSearch = WorktreeMissingErrorData & {
  readonly environmentId?: string;
};

export const Route = createFileRoute("/session/fallback")({
  staticData: { cardHeading: CARD_HEADING },
  validateSearch: (search: Record<string, unknown>): FallbackSearch => ({
    sessionId: asText(search.sessionId) ?? "",
    projectId: asText(search.projectId) ?? "",
    branch: asText(search.branch) ?? "",
    ...(asText(search.environmentId) === undefined
      ? undefined
      : { environmentId: asText(search.environmentId) }),
  }),
  beforeLoad: ({ search }) => {
    if (search.sessionId === "" || search.projectId === "" || search.branch === "") {
      throw redirect({ to: "/draft" });
    }
  },
  component: MissingWorktreeRoute,
});

function MissingWorktreeRoute() {
  const search = Route.useSearch();
  const { environmentRpc, localEnvironmentId } = Route.useRouteContext();
  const environmentId = search.environmentId ?? localEnvironmentId;
  const orpcQueryUtils = environmentRpc.for(environmentId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ref = { projectId: search.projectId, sessionId: search.sessionId };
  const restore = useMutation({
    mutationKey: orpcQueryUtils.agent.session.restoreWorktree.key(),
    mutationFn: () => orpcQueryUtils.agent.session.restoreWorktree.call({ ref }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.git.branch.queryOptions({ input: { ref } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.fs.readTree.queryOptions({ input: { ref } }).queryKey,
      });
      return navigate({
        to: "/session/$sessionId",
        params: { sessionId: search.sessionId },
        search: { projectId: search.projectId, environmentId },
      });
    },
    onError: (error) => toast.error(`Failed to restore worktree: ${error.message}`),
  });

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{CARD_HEADING}</EmptyTitle>
        <EmptyDescription>
          This session&apos;s checkout was removed. Restore {search.branch} to continue.
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
