import type { PrepareSessionOutput, SessionRef } from "@getpie/contract";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { toast } from "sonner";

import { Chat } from "@/features/chat/chat";
import { parseWorktreeMissingError } from "@/features/session/worktree-missing";

type SessionSearch = {
  readonly projectId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const redirectForWorktreeMissing = (error: unknown): void => {
  const missing = parseWorktreeMissingError(error);
  if (missing === undefined) return;
  throw redirect({
    to: "/session/fallback",
    search: {
      sessionId: missing.sessionId,
      projectId: missing.projectId,
    },
  });
};

const catchPrepareError = <T,>(error: unknown, onOther: (error: unknown) => T): T => {
  if (isRedirect(error)) throw error;
  redirectForWorktreeMissing(error);
  return onOther(error);
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
      const prepared = await session.prepare.call({ ref });
      void context.queryClient.prefetchQuery(
        context.orpcQueryUtils.git.branch.queryOptions({ input: { ref } }),
      );
      return prepared;
    };

    if (deps.projectId !== undefined) {
      const hinted = {
        projectId: deps.projectId,
        sessionId: params.sessionId,
      };
      const prepared = await prepareSession(hinted).catch((error: unknown) =>
        catchPrepareError(error, (err) => {
          console.warn("Preparing the URL's ref failed, falling back to lookup", err);
          return undefined;
        }),
      );
      if (prepared) return prepared;
    }

    const ref = await session.resolveRef
      .call({ sessionId: params.sessionId })
      .catch((error: unknown) => {
        console.error("Failed to resolve session", error);
        toast.error(`Session ${params.sessionId} could not be found.`);
        throw redirect({ to: "/draft" });
      });
    return prepareSession(ref).catch((error: unknown) =>
      catchPrepareError(error, (err) => {
        console.error("Failed to prepare session", err);
        toast.error(
          `Failed to prepare session: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }),
    );
  },
  component: Component,
});

function Component() {
  const prepared = Route.useLoaderData();
  return <Chat sessionRef={prepared.ref} />;
}
