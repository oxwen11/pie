import type {
  AgentModelState,
  PromptInput,
  SessionRef,
  SessionSummary,
  SessionWorkspace,
} from "@getpie/contract";
import type { PullRequestRef } from "@getpie/contract/pull-request";
import { Effect } from "effect";

import type { ProjectNotFound, SessionNotFound, StoreReadError, StoreWriteError } from "../errors";
import type { EventBusShape } from "../events/event-bus";
import type { Session } from "../types";
import { inSession } from "./session-identity";
import type { SessionMetadataLocks } from "./session-locks";
import type { PiAgentSessionManagerShape } from "./session-manager";
import type { PiAgentSessionRepositoryShape } from "./session-repository";

const MAX_TITLE_CHARS = 60;
const deriveTitle = (parts: PromptInput["parts"]): string | undefined => {
  const text = parts.find((part) => part.type === "text")?.text.trim();
  if (!text) return undefined;
  const collapsed = text.replaceAll(/\s+/g, " ");
  return collapsed.length > MAX_TITLE_CHARS ? collapsed.slice(0, MAX_TITLE_CHARS) : collapsed;
};

export type SessionWithCwd = Session & { readonly cwd: string };

export const toSessionWorkspace = (metadata: SessionWithCwd): SessionWorkspace => ({
  cwd: metadata.cwd,
  ...(metadata.gitBranch !== undefined ? { gitBranch: metadata.gitBranch } : undefined),
});

const samePullRequestRef = (left: PullRequestRef, right: PullRequestRef): boolean =>
  left.host === right.host &&
  left.owner === right.owner &&
  left.repository === right.repository &&
  left.number === right.number;

export const modelStateFromMetadata = (metadata: Session): AgentModelState => ({
  ...(metadata.provider !== undefined ? { provider: metadata.provider } : undefined),
  ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : undefined),
});

export const logLifecycle = (event: string, message: string, extra: Record<string, unknown> = {}) =>
  Effect.logInfo(message).pipe(Effect.annotateLogs({ event, ...extra }));

export type SessionMetadata = {
  readonly readMetadata: (
    ref: SessionRef,
  ) => Effect.Effect<Session, SessionNotFound | StoreReadError>;
  readonly ensureCwd: (
    metadata: Session,
  ) => Effect.Effect<SessionWithCwd, ProjectNotFound | StoreReadError | StoreWriteError>;
  readonly workspaceFor: (
    ref: SessionRef,
  ) => Effect.Effect<SessionWorkspace, SessionNotFound | ProjectNotFound | StoreReadError>;
  readonly rename: (
    ref: SessionRef,
    title: string,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly archive: (
    ref: SessionRef,
    archived: boolean,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly pullRequestRefsFor: (
    ref: SessionRef,
  ) => Effect.Effect<ReadonlyArray<PullRequestRef>, SessionNotFound | StoreReadError>;
  readonly rememberPullRequestRef: (
    ref: SessionRef,
    pullRequest: PullRequestRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly list: (
    projectId: string,
    archived: boolean,
  ) => Effect.Effect<ReadonlyArray<SessionSummary>, StoreReadError>;
  readonly readAndStampTitleFromFirstPrompt: (
    ref: SessionRef,
    parts: PromptInput["parts"],
  ) => Effect.Effect<Session, SessionNotFound | StoreReadError>;
};

export const makeSessionMetadata = (deps: {
  readonly repo: PiAgentSessionRepositoryShape;
  readonly bus: EventBusShape;
  readonly locks: SessionMetadataLocks;
  readonly projectPathFor: (
    projectId: string,
  ) => Effect.Effect<string, ProjectNotFound | StoreReadError>;
  readonly manager: PiAgentSessionManagerShape;
}): SessionMetadata => {
  const { repo, bus, locks, projectPathFor, manager } = deps;
  const withMetadataMutation = locks.withLock;
  const readMetadata = (ref: SessionRef) => repo.read(ref.projectId, ref.sessionId);

  const ensureCwd = (
    metadata: Session,
  ): Effect.Effect<SessionWithCwd, ProjectNotFound | StoreReadError | StoreWriteError> =>
    metadata.cwd !== undefined
      ? Effect.succeed(metadata as SessionWithCwd)
      : projectPathFor(metadata.projectId).pipe(
          Effect.flatMap((cwd) =>
            repo.write({ ...metadata, cwd }).pipe(Effect.map(() => ({ ...metadata, cwd }))),
          ),
        );

  return {
    readMetadata,
    ensureCwd,

    workspaceFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          metadata.cwd !== undefined
            ? Effect.succeed(toSessionWorkspace(metadata as SessionWithCwd))
            : projectPathFor(metadata.projectId).pipe(
                Effect.map((cwd) => toSessionWorkspace({ ...metadata, cwd })),
              ),
        ),
        inSession(ref),
      ),

    rename: (ref, title) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) =>
            metadata.title === title
              ? Effect.void
              : repo
                  .write({ ...metadata, title })
                  .pipe(Effect.andThen(bus.publish({ ref, type: "session.renamed", title }))),
          ),
        ),
      ).pipe(inSession(ref)),

    archive: (ref, archived) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            const changed = (metadata.archived ?? false) !== archived;
            const persist = changed ? repo.write({ ...metadata, archived }) : Effect.void;
            const close = archived
              ? manager.close(ref).pipe(Effect.andThen(bus.closeSession(ref, "session_closed")))
              : Effect.void;
            const publish = changed
              ? bus.publish({ ref, type: "session.archived", archived }).pipe(
                  Effect.andThen(
                    logLifecycle("session.archived", "session archive state changed", {
                      archived,
                    }),
                  ),
                )
              : Effect.void;
            return persist.pipe(Effect.andThen(close), Effect.andThen(publish));
          }),
        ),
      ).pipe(inSession(ref)),

    pullRequestRefsFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.map((metadata) => metadata.pullRequestRefs ?? []),
        inSession(ref),
      ),

    rememberPullRequestRef: (ref, pullRequest) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            const existing = metadata.pullRequestRefs ?? [];
            if (existing.some((candidate) => samePullRequestRef(candidate, pullRequest))) {
              return Effect.void;
            }
            return repo.write({
              ...metadata,
              pullRequestRefs: [...existing, pullRequest],
            });
          }),
        ),
      ).pipe(inSession(ref)),

    list: (projectId, archived) =>
      repo.list(projectId).pipe(
        Effect.map((sessions) =>
          sessions.filter((metadata) => (metadata.archived ?? false) === archived),
        ),
        Effect.flatMap((sessions) =>
          Effect.forEach(sessions, (metadata) =>
            manager
              .liveStatus({
                projectId: metadata.projectId,
                sessionId: metadata.sessionId,
              })
              .pipe(
                Effect.map(
                  (status) =>
                    ({
                      projectId: metadata.projectId,
                      sessionId: metadata.sessionId,
                      archived: metadata.archived ?? false,
                      createdAt: metadata.createdAt,
                      historyAvailable: metadata.historyAvailable ?? true,
                      ...(metadata.title !== undefined ? { title: metadata.title } : undefined),
                      ...(metadata.updatedAt !== undefined
                        ? { updatedAt: metadata.updatedAt }
                        : undefined),
                      ...(status !== undefined ? { status } : undefined),
                    }) satisfies SessionSummary,
                ),
              ),
          ),
        ),
      ),

    readAndStampTitleFromFirstPrompt: (ref, parts) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.title !== undefined) return Effect.succeed(metadata);
            const title = deriveTitle(parts);
            if (title === undefined) return Effect.succeed(metadata);
            const updated = { ...metadata, title };
            return repo.write(updated).pipe(
              Effect.andThen(bus.publish({ ref, type: "session.updated", title })),
              Effect.as(updated),
              Effect.catchTag("StoreWriteError", () => Effect.succeed(metadata)),
            );
          }),
        ),
      ),
  };
};
