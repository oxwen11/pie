import type { PrepareSessionOutput, SessionRef, WorktreeMissingErrorData } from "@getpie/contract";
import { ORPCError } from "@orpc/client";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { toast } from "sonner";

import { Chat } from "@/features/chat/chat";

type SessionSearch = {
  readonly projectId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const parseWorktreeMissingError = (error: unknown): WorktreeMissingErrorData | undefined => {
  if (!(error instanceof ORPCError) || error.code !== "WORKTREE_MISSING") return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const sessionId = asText("sessionId" in data ? data.sessionId : undefined);
  const projectId = asText("projectId" in data ? data.projectId : undefined);
  const branch = asText("branch" in data ? data.branch : undefined);
  if (sessionId === undefined || projectId === undefined || branch === undefined) return undefined;
  return { sessionId, projectId, branch };
};

const throwWorktreeMissingRedirect = (error: unknown): void => {
  if (isRedirect(error)) throw error;
  const missing = parseWorktreeMissingError(error);
  if (missing === undefined) return;
  throw redirect({
    to: "/session/fallback",
    search: {
      sessionId: missing.sessionId,
      projectId: missing.projectId,
      branch: missing.branch,
    },
  });
};

export const Route = createFileRoute("/session/$sessionId")({
  validateSearch: (search: Record<string, unknown>): SessionSearch => {
    const projectId = asText(search.projectId);
    return projectId !== undefined ? { projectId } : {};
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }): Promise<PrepareSessionOutput> => {
    const { session } = context.orpcQueryUtils.agent;
    const prepareSession = async (ref: SessionRef) => {
      const prepared = session.prepare.call({ ref });
      void context.queryClient.prefetchQuery(
        context.orpcQueryUtils.git.branch.queryOptions({ input: { ref } }),
      );
      try {
        return await prepared;
      } catch (error: unknown) {
        throwWorktreeMissingRedirect(error);
        throw error;
      }
    };

    if (deps.projectId !== undefined) {
      const hinted = {
        projectId: deps.projectId,
        sessionId: params.sessionId,
      };
      const prepared = await prepareSession(hinted).catch((error: unknown) => {
        if (isRedirect(error)) throw error;
        console.warn("Preparing the URL's ref failed, falling back to lookup", error);
        return undefined;
      });
      if (prepared) return prepared;
    }

    const ref = await session.resolveRef
      .call({ sessionId: params.sessionId })
      .catch((error: unknown) => {
        console.error("Failed to resolve session", error);
        toast.error(`Session ${params.sessionId} could not be found.`);
        throw redirect({ to: "/draft" });
      });
    return prepareSession(ref).catch((error: unknown) => {
      if (isRedirect(error)) throw error;
      console.error("Failed to prepare session", error);
      toast.error(
        `Failed to prepare session: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    });
  },
  component: Component,
});

function Component() {
  const prepared = Route.useLoaderData();
  return <Chat sessionRef={prepared.ref} />;
}
