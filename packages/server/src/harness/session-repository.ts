import { type JsonStoreLoadError, makeJsonCollection } from "@getpie/effect-json-store";
import { Effect, Option, Schema } from "effect";

import { SessionNotFound, SessionRefNotFound, StoreReadError, StoreWriteError } from "../errors";
import type { Session } from "../types";

const SessionSchema = Schema.Struct({
  sessionId: Schema.String,
  projectId: Schema.String,
  agentSessionId: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
  gitBranch: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  archived: Schema.optionalKey(Schema.Boolean),
  updatedAt: Schema.optionalKey(Schema.String),
  historyAvailable: Schema.optionalKey(Schema.Boolean),
});

/** Drop the create-time sentinel (`agentSessionId === sessionId`) from old records. */
const fromStorage = (parsed: typeof SessionSchema.Type): Session => {
  const { agentSessionId, ...rest } = parsed;
  const opened =
    agentSessionId !== undefined && agentSessionId !== parsed.sessionId
      ? agentSessionId
      : undefined;
  return {
    ...rest,
    ...(opened !== undefined ? { agentSessionId: opened } : {}),
  };
};

const toStorage = (metadata: Session): typeof SessionSchema.Type => ({
  sessionId: metadata.sessionId,
  projectId: metadata.projectId,
  createdAt: metadata.createdAt,
  ...(metadata.agentSessionId !== undefined ? { agentSessionId: metadata.agentSessionId } : {}),
  ...(metadata.cwd !== undefined ? { cwd: metadata.cwd } : {}),
  ...(metadata.gitBranch !== undefined ? { gitBranch: metadata.gitBranch } : {}),
  ...(metadata.provider !== undefined ? { provider: metadata.provider } : {}),
  ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : {}),
  ...(metadata.title !== undefined ? { title: metadata.title } : {}),
  ...(metadata.archived !== undefined ? { archived: metadata.archived } : {}),
  ...(metadata.updatedAt !== undefined ? { updatedAt: metadata.updatedAt } : {}),
  ...(metadata.historyAvailable !== undefined
    ? { historyAvailable: metadata.historyAvailable }
    : {}),
});

/**
 * Data access for `storage/sessions/<projectId>/<sessionId>.json`. The filename
 * mirrors {@link Session.sessionId}, which the body also carries. No business
 * rules — orchestration (id generation, projectId resolution) lives in
 * {@link PiAgentSessionService}, whose internal collaborator this is; it
 * has no Context tag of its own.
 */
export type PiAgentSessionRepositoryShape = {
  /** All session metadata under a project; empty if the project dir is absent. */
  readonly list: (projectId: string) => Effect.Effect<ReadonlyArray<Session>, StoreReadError>;
  readonly read: (
    projectId: string,
    sessionId: string,
  ) => Effect.Effect<Session, StoreReadError | SessionNotFound>;
  /**
   * Reverse lookup: find a session by its (globally unique) sessionId alone,
   * scanning every project directory. The record carries its own projectId.
   */
  readonly findBySessionId: (
    sessionId: string,
  ) => Effect.Effect<Session, StoreReadError | SessionRefNotFound>;
  readonly write: (metadata: Session) => Effect.Effect<void, StoreWriteError>;
  /** Idempotent: removing an absent file succeeds. */
  readonly remove: (projectId: string, sessionId: string) => Effect.Effect<void, StoreWriteError>;
};

/**
 * Ids reach this repository from RPC input, so they must be sanitized before
 * they become path segments: the collection treats an invalid id as a defect
 * (caller bug), but here a malformed id is client data and means "no such
 * session", not a crash.
 */
const isSafeId = (id: string): boolean =>
  id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== "..";

export const makePiAgentSessionRepository = (sessionsDir: string) =>
  Effect.gen(function* () {
    const sessions = yield* makeJsonCollection({
      dir: sessionsDir,
      schema: SessionSchema,
    });
    const entryId = (projectId: string, sessionId: string) => `${projectId}/${sessionId}`;
    const asReadError = (error: JsonStoreLoadError) =>
      new StoreReadError({ file: error.file, cause: error });
    const asWriteError = (error: { readonly file: string }) =>
      new StoreWriteError({ file: error.file, cause: error });

    return {
      list: (projectId) =>
        isSafeId(projectId)
          ? sessions.list({ under: projectId }).pipe(
              Effect.map((entries) => entries.map((entry) => fromStorage(entry.data))),
              Effect.mapError(asReadError),
            )
          : Effect.succeed([]),

      read: (projectId, sessionId) =>
        !isSafeId(projectId) || !isSafeId(sessionId)
          ? Effect.fail(new SessionNotFound({ projectId, sessionId }))
          : sessions.get(entryId(projectId, sessionId)).pipe(
              Effect.mapError(asReadError),
              Effect.flatMap((found) =>
                Option.isSome(found)
                  ? Effect.succeed(fromStorage(found.value))
                  : Effect.fail(new SessionNotFound({ projectId, sessionId })),
              ),
            ),

      findBySessionId: (sessionId) =>
        !isSafeId(sessionId)
          ? Effect.fail(new SessionRefNotFound({ sessionId }))
          : Effect.gen(function* () {
              const ids = yield* sessions.ids().pipe(Effect.mapError(asReadError));
              const id = ids.find((candidate) => candidate.endsWith(`/${sessionId}`));
              const found =
                id === undefined
                  ? Option.none<typeof SessionSchema.Type>()
                  : yield* sessions.get(id).pipe(Effect.mapError(asReadError));
              if (Option.isNone(found)) {
                return yield* Effect.fail(new SessionRefNotFound({ sessionId }));
              }
              return fromStorage(found.value);
            }),

      write: (metadata) =>
        sessions
          .put(entryId(metadata.projectId, metadata.sessionId), toStorage(metadata))
          .pipe(Effect.mapError(asWriteError)),

      remove: (projectId, sessionId) =>
        !isSafeId(projectId) || !isSafeId(sessionId)
          ? Effect.void
          : sessions.remove(entryId(projectId, sessionId)).pipe(Effect.mapError(asWriteError)),
    } satisfies PiAgentSessionRepositoryShape;
  });
