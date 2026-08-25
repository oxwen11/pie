import type { PrepareSessionOutput } from "@getpie/contract";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";

import { Chat } from "@/features/chat/chat";

type SessionSearch = {
  readonly projectId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const Route = createFileRoute("/session/$sessionId")({
  validateSearch: (search: Record<string, unknown>): SessionSearch => {
    const projectId = asText(search.projectId);
    return projectId !== undefined ? { projectId } : {};
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }): Promise<PrepareSessionOutput> => {
    const { session } = context.orpcQueryUtils.agent;

    if (deps.projectId !== undefined) {
      const hinted = {
        projectId: deps.projectId,
        sessionId: params.sessionId,
      };
      const prepared = await session.prepare.call({ ref: hinted }).catch((error: unknown) => {
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
    return session.prepare.call({ ref }).catch((error: unknown) => {
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
