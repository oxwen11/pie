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
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { parseWorktreeMissingError } from "@/features/session/worktree-missing";

type FallbackSearch = {
  readonly sessionId: string;
  readonly projectId: string;
  readonly branch?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const Route = createFileRoute("/session/fallback")({
  staticData: { cardHeading: "Can't open session" },
  validateSearch: (search: Record<string, unknown>): FallbackSearch => {
    const sessionId = asText(search.sessionId) ?? "";
    const projectId = asText(search.projectId) ?? "";
    const branch = asText(search.branch);
    return branch === undefined ? { sessionId, projectId } : { sessionId, projectId, branch };
  },
  beforeLoad: ({ search }) => {
    if (search.sessionId === "" || search.projectId === "") {
      throw redirect({ to: "/draft" });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const ref = { projectId: deps.projectId, sessionId: deps.sessionId };
    try {
      await context.orpcQueryUtils.agent.session.prepare.call({ ref });
      throw redirect({
        to: "/session/$sessionId",
        params: { sessionId: deps.sessionId },
        search: { projectId: deps.projectId },
      });
    } catch (error: unknown) {
      if (isRedirect(error)) throw error;
      if (parseWorktreeMissingError(error) !== undefined) return;
      throw redirect({ to: "/draft" });
    }
  },
  component: MissingWorktreeRoute,
});

function MissingWorktreeRoute() {
  const search = Route.useSearch();
  const { orpcQueryUtils } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ref = { projectId: search.projectId, sessionId: search.sessionId };
  const restore = useMutation({
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
        search: { projectId: search.projectId },
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
        <EmptyTitle>Can&apos;t open session</EmptyTitle>
        <EmptyDescription>
          {search.branch === undefined
            ? "This session's checkout was removed."
            : `This session's checkout was removed. Restore ${search.branch} to continue.`}
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
