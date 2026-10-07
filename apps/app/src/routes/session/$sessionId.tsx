import type { PrepareSessionOutput, SessionRef, WorktreeMissingErrorData } from "@getpie/contract";
import { ORPCError } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { toast } from "sonner";

import { ShellTitle } from "@/components/layout/app-shell";
import { Chat } from "@/features/chat/chat";
import { useProjectSessionTitle } from "@/features/projects/use-project-sessions";
import { useProject } from "@/features/projects/use-projects";

type SessionSearch = {
  readonly projectId?: string;
  readonly environmentId?: string;
};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const throwWorktreeMissingRedirect = (error: unknown, environmentId: string): void => {
  if (!(error instanceof ORPCError) || error.code !== "WORKTREE_MISSING") return;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return;
  const sessionId = asText("sessionId" in data ? data.sessionId : undefined);
  const projectId = asText("projectId" in data ? data.projectId : undefined);
  const branch = asText("branch" in data ? data.branch : undefined);
  if (sessionId === undefined || projectId === undefined || branch === undefined) return;
  throw redirect({
    to: "/session/fallback",
    search: { sessionId, projectId, branch, environmentId } satisfies WorktreeMissingErrorData & {
      environmentId: string;
    },
  });
};

export const Route = createFileRoute("/session/$sessionId")({
  validateSearch: (search: Record<string, unknown>): SessionSearch => {
    const projectId = asText(search.projectId);
    const environmentId = asText(search.environmentId);
    if (projectId !== undefined && environmentId !== undefined) {
      return { projectId, environmentId };
    }
    if (projectId !== undefined) return { projectId };
    if (environmentId !== undefined) return { environmentId };
    return {};
  },
  loaderDeps: ({ search }) => search,
  loader: async ({
    context,
    params,
    deps,
  }): Promise<PrepareSessionOutput & { environmentId: string }> => {
    const environmentId = deps.environmentId ?? context.localEnvironmentId;
    const orpc = context.environmentRpc.for(environmentId);
    const { session } = orpc;
    const prepareSession = (ref: SessionRef) => {
      void context.environmentRpc.queryClient.prefetchQuery({
        ...orpc.git.branch.queryOptions({ input: { ref } }),
        meta: { errorMode: "inline" },
      });
      return session.prepare.call({ ref });
    };

    if (deps.projectId !== undefined) {
      const hinted = {
        projectId: deps.projectId,
        sessionId: params.sessionId,
      };
      const prepared = await prepareSession(hinted).catch((error: unknown) => {
        throwWorktreeMissingRedirect(error, environmentId);
        console.warn("Preparing the URL's ref failed, falling back to lookup", error);
        return undefined;
      });
      if (prepared) return { ...prepared, environmentId };
    }

    const ref = await session.resolveRef
      .call({ sessionId: params.sessionId })
      .catch((error: unknown) => {
        console.error("Failed to resolve session", error);
        toast.error(`Session ${params.sessionId} could not be found.`);
        throw redirect({ to: "/draft", search: { environmentId } });
      });
    return prepareSession(ref)
      .then((prepared) => ({ ...prepared, environmentId }))
      .catch((error: unknown) => {
        throwWorktreeMissingRedirect(error, environmentId);
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
  const project = useProject(prepared.ref.projectId);
  const title = useProjectSessionTitle(prepared.ref) ?? "New chat";
  return (
    <>
      <ShellTitle>
        <h1
          className="m-0 flex max-w-full min-w-0 items-center gap-1 self-center text-sm leading-6 font-medium"
          data-app-shell-titlebar-content=""
        >
          <span
            aria-label={project === undefined ? undefined : `Project: ${project.name}`}
            className="flex size-7 shrink-0 items-center justify-center [-webkit-app-region:no-drag]"
            role="img"
          >
            <FolderIcon className="size-4" />
          </span>
          <span className="min-w-0 truncate" title={title}>
            {title}
          </span>
        </h1>
      </ShellTitle>
      <Chat
        sessionRef={{
          environmentId: prepared.environmentId,
          ref: prepared.ref,
        }}
      />
    </>
  );
}
