import { type JsonStoreLoadError, makeJsonCollection } from "@pie/effect-json-store";
import { Effect, Option, Schema } from "effect";

import { SessionNotFound, SessionRefNotFound, StoreReadError, StoreWriteError } from "../errors";
import type { Session } from "../types";

const SessionFields = {
  sessionId: Schema.String,
  projectId: Schema.String,
  createdAt: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  archived: Schema.optionalKey(Schema.Boolean),
  updatedAt: Schema.optionalKey(Schema.String),
  historyAvailable: Schema.optionalKey(Schema.Boolean),
};

const SessionWireSchema = Schema.Struct({
  ...SessionFields,
  agentSessionId: Schema.optionalKey(Schema.String),
  harnessSessionId: Schema.optionalKey(Schema.String),
});

const omitUndefinedOptionals = (metadata: Session): typeof SessionWireSchema.Type => ({
  sessionId: metadata.sessionId,
  projectId: metadata.projectId,
  agentSessionId: metadata.agentSessionId,
  createdAt: metadata.createdAt,
  ...(metadata.cwd !== undefined ? { cwd: metadata.cwd } : {}),
  ...(metadata.title !== undefined ? { title: metadata.title } : {}),
  ...(metadata.archived !== undefined ? { archived: metadata.archived } : {}),
  ...(metadata.updatedAt !== undefined ? { updatedAt: metadata.updatedAt } : {}),
  ...(metadata.historyAvailable !== undefined
    ? { historyAvailable: metadata.historyAvailable }
    : {}),
});

const toSession = (wire: typeof SessionWireSchema.Type): Session => ({
  sessionId: wire.sessionId,
  projectId: wire.projectId,
  agentSessionId: wire.agentSessionId ?? wire.harnessSessionId ?? "",
  createdAt: wire.createdAt,
  ...(wire.cwd !== undefined ? { cwd: wire.cwd } : {}),
  ...(wire.title !== undefined ? { title: wire.title } : {}),
  ...(wire.archived !== undefined ? { archived: wire.archived } : {}),
  ...(wire.updatedAt !== undefined ? { updatedAt: wire.updatedAt } : {}),
  ...(wire.historyAvailable !== undefined ? { historyAvailable: wire.historyAvailable } : {}),
});

/**
 * Data access for `storage/sessions/<projectId>/<sessionId>.json`. The filename
 * mirrors {@link Session.sessionId}, which the body also carries. No business
 * rules — orchestration (id generation, projectId resolution) lives in
 * {@link HarnessAgentSessionService}, whose internal collaborator this is; it
 * has no Context tag of its own.
 */
export type HarnessAgentSessionRepositoryShape = {
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

export const makeHarnessAgentSessionRepository = (sessionsDir: string) =>
  Effect.gen(function* () {
    const sessions = yield* makeJsonCollection({
      dir: sessionsDir,
      schema: SessionWireSchema,
      legacy: {
        schema: SessionWireSchema,
        migrate: (session) => toSession(session),
      },
    });
    const entryId = (projectId: string, sessionId: string) => `${projectId}/${sessionId}`;
    const asReadError = (error: JsonStoreLoadError) =>
      new StoreReadError({ file: error.file, cause: error });
    const asWriteError = (error: { readonly file: string }) =>
      new StoreWriteError({ file: error.file, cause: error });

    return {
      list: (projectId) =>
        // Scoped to the project's own subdirectory: a corrupt record in
        // another project cannot fail this listing.
        isSafeId(projectId)
          ? sessions.list({ under: projectId }).pipe(
              Effect.map((entries) => entries.map((entry) => toSession(entry.data))),
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
                  ? Effect.succeed(toSession(found.value))
                  : Effect.fail(new SessionNotFound({ projectId, sessionId })),
              ),
            ),

      findBySessionId: (sessionId) =>
        // Scan filenames only (no entry bodies), then read the single match.
        !isSafeId(sessionId)
          ? Effect.fail(new SessionRefNotFound({ sessionId }))
          : Effect.gen(function* () {
              const ids = yield* sessions.ids().pipe(Effect.mapError(asReadError));
              const id = ids.find((candidate) => candidate.endsWith(`/${sessionId}`));
              const found =
                id === undefined
                  ? Option.none<typeof SessionWireSchema.Type>()
                  : yield* sessions.get(id).pipe(Effect.mapError(asReadError));
              if (Option.isNone(found)) {
                return yield* Effect.fail(new SessionRefNotFound({ sessionId }));
              }
              return toSession(found.value);
            }),

      write: (metadata) =>
        sessions
          .put(entryId(metadata.projectId, metadata.sessionId), omitUndefinedOptionals(metadata))
          .pipe(Effect.mapError(asWriteError)),

      remove: (projectId, sessionId) =>
        !isSafeId(projectId) || !isSafeId(sessionId)
          ? Effect.void
          : sessions.remove(entryId(projectId, sessionId)).pipe(Effect.mapError(asWriteError)),
    } satisfies HarnessAgentSessionRepositoryShape;
  });
