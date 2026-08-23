import type {
  AgentModelState,
  AgentResponse,
  PromptInput,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionSummary,
} from "@pie/contract";
import type { SessionCapabilities } from "@pie/contract";
import type { UIMessage } from "ai";
import { Context, Crypto, Effect, FileSystem, Layer, Semaphore } from "effect";

import { Paths } from "../config/paths";
import {
  type SessionNotFound,
  type SessionRefNotFound,
  type StoreReadError,
  type StoreWriteError,
  UnsupportedPromptPart,
} from "../errors";
import { EventBus, type EventBusShape } from "../events/event-bus";
import type { Session } from "../types";
import type {
  AgentOperationError,
  CreateSessionError,
  HarnessSessionNotFound,
  ResumeSessionError,
  SessionClosed,
  TurnAlreadyRunning,
} from "./errors";
import { AgentRequestUnavailable, CapabilityUnsupported, SessionNotResumable } from "./errors";
import type { PiAgentShape } from "./pi/facade";
import { PiAgent } from "./pi/facade";
import type { PiAgentRuntime } from "./pi/runtime";
import type { SessionInfoResult } from "./pi/types";
import { inSession } from "./session-identity";
import type { PromptReceipt, UserInput } from "./session-io";
import type { PiAgentSessionManagerShape } from "./session-manager";
import { PiAgentSessionManager } from "./session-manager";
import {
  type PiAgentSessionRepositoryShape,
  makePiAgentSessionRepository,
} from "./session-repository";

const MAX_TITLE_CHARS = 60;
const deriveTitle = (parts: PromptInput["parts"]): string | undefined => {
  const text = parts.find((part) => part.type === "text")?.text.trim();
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ");
  return collapsed.length > MAX_TITLE_CHARS ? collapsed.slice(0, MAX_TITLE_CHARS) : collapsed;
};

const toUserInput = (
  parts: PromptInput["parts"],
): Effect.Effect<UserInput, UnsupportedPromptPart> =>
  Effect.forEach(parts, (part) =>
    part.type === "file"
      ? Effect.fail(new UnsupportedPromptPart({ kind: "file" }))
      : Effect.succeed(part),
  ).pipe(Effect.map((userParts) => ({ parts: userParts })));

export type PiAgentSessionServiceShape = {
  readonly create: (
    projectId: string,
    cwd: string,
    model?: { readonly provider: string; readonly modelId: string },
  ) => Effect.Effect<SessionRef, CreateSessionError | StoreWriteError>;
  readonly prepare: (
    ref: SessionRef,
    cwd: string,
  ) => Effect.Effect<
    void,
    SessionNotFound | StoreReadError | StoreWriteError | SessionNotResumable | AgentOperationError
  >;
  readonly close: (ref: SessionRef) => Effect.Effect<void, SessionNotFound | StoreReadError>;
  readonly delete: (
    ref: SessionRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly rename: (
    ref: SessionRef,
    title: string,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly archive: (
    ref: SessionRef,
    archived: boolean,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly list: (
    projectId: string,
    archived: boolean,
  ) => Effect.Effect<ReadonlyArray<SessionSummary>, StoreReadError>;
  readonly getMessages: (
    ref: SessionRef,
    cwd: string,
  ) => Effect.Effect<
    ReadonlyArray<UIMessage>,
    | SessionNotFound
    | StoreReadError
    | ResumeSessionError
    | CapabilityUnsupported
    | SessionClosed
    | AgentOperationError
  >;
  readonly prompt: (
    input: PromptInput,
  ) => Effect.Effect<
    PromptReceipt,
    | SessionNotFound
    | StoreReadError
    | UnsupportedPromptPart
    | ResumeSessionError
    | SessionClosed
    | TurnAlreadyRunning
    | AgentOperationError
  >;
  readonly interrupt: (
    ref: SessionRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | SessionClosed | AgentOperationError>;
  readonly respondToAgentRequest: (
    ref: SessionRef,
    requestId: string,
    response: AgentResponse,
  ) => Effect.Effect<
    void,
    SessionNotFound | StoreReadError | AgentRequestUnavailable | AgentOperationError
  >;
  readonly getCapabilities: (
    ref: SessionRef,
  ) => Effect.Effect<
    SessionCapabilities,
    | SessionNotFound
    | StoreReadError
    | HarnessSessionNotFound
    | CapabilityUnsupported
    | AgentOperationError
  >;
  readonly getModelState: (
    ref: SessionRef,
    cwd: string,
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | StoreReadError
    | ResumeSessionError
    | CapabilityUnsupported
    | SessionClosed
    | AgentOperationError
  >;
  readonly setModel: (
    ref: SessionRef,
    cwd: string,
    model: { readonly provider: string; readonly modelId: string },
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | StoreReadError
    | ResumeSessionError
    | CapabilityUnsupported
    | SessionClosed
    | AgentOperationError
  >;
  readonly getSessionInfo: (
    ref: SessionRef,
  ) => Effect.Effect<SessionInfoResult, SessionNotFound | StoreReadError | AgentOperationError>;
  readonly getStatus: (ref: SessionRef) => Effect.Effect<SessionStatus>;
  readonly getSnapshot: (ref: SessionRef) => Effect.Effect<SessionRuntimeSnapshot>;
  readonly resolveRef: (
    sessionId: string,
  ) => Effect.Effect<SessionRef, StoreReadError | SessionRefNotFound>;
};

export class PiAgentSessionService extends Context.Service<
  PiAgentSessionService,
  PiAgentSessionServiceShape
>()("PiAgentSessionService") {}

export const makePiAgentSessionService = (deps: {
  readonly manager: PiAgentSessionManagerShape;
  readonly pi: PiAgentShape;
  readonly repo: PiAgentSessionRepositoryShape;
  readonly bus: EventBusShape;
  readonly newSessionId: Effect.Effect<string>;
}): PiAgentSessionServiceShape => {
  const { manager, pi, repo, bus, newSessionId } = deps;

  const metadataMutationLocks = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
  const withMetadataMutation = <A, E, R>(
    ref: SessionRef,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => {
    const key = `${ref.projectId}\0${ref.sessionId}`;
    const lock = metadataMutationLocks.get(key) ?? Semaphore.makeUnsafe(1);
    metadataMutationLocks.set(key, lock);
    return lock.withPermit(effect);
  };

  const readMetadata = (ref: SessionRef) => repo.read(ref.projectId, ref.sessionId);

  const readHistory = (
    ref: SessionRef,
    agentSessionId: string,
    cwd: string,
  ): Effect.Effect<
    ReadonlyArray<UIMessage>,
    ResumeSessionError | CapabilityUnsupported | SessionClosed | AgentOperationError
  > => {
    const cold = pi.getMessages;
    if (cold) return cold(agentSessionId, cwd);
    return manager
      .ensureRuntime({ sessionId: agentSessionId, cwd }, ref)
      .pipe(
        Effect.flatMap(
          (
            runtime,
          ): Effect.Effect<
            ReadonlyArray<UIMessage>,
            CapabilityUnsupported | SessionClosed | AgentOperationError
          > =>
            runtime.getMessages ??
            Effect.fail(new CapabilityUnsupported({ capability: "getMessages" })),
        ),
      );
  };

  const resolveAgentSessionId = (ref: SessionRef) =>
    readMetadata(ref).pipe(Effect.map((metadata) => metadata.agentSessionId));

  const runtimeInput = (agentSessionId: string, cwd: string) => ({
    sessionId: agentSessionId,
    cwd,
  });

  const withLiveRuntime = <A, E>(
    ref: SessionRef,
    agentSessionId: string,
    cwd: string,
    run: (
      runtime: PiAgentRuntime,
    ) => Effect.Effect<A, CapabilityUnsupported | SessionClosed | AgentOperationError | E>,
  ): Effect.Effect<
    A,
    ResumeSessionError | CapabilityUnsupported | SessionClosed | AgentOperationError | E
  > => manager.ensureRuntime(runtimeInput(agentSessionId, cwd), ref).pipe(Effect.flatMap(run));

  const readAndStampTitleFromFirstPrompt = (ref: SessionRef, parts: PromptInput["parts"]) =>
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
    );

  const logLifecycle = (event: string, message: string, extra: Record<string, unknown> = {}) =>
    Effect.logInfo(message).pipe(Effect.annotateLogs({ event, ...extra }));

  return {
    create: (projectId, cwd, model) =>
      newSessionId.pipe(
        Effect.flatMap((sessionId) => {
          const ref: SessionRef = { projectId, sessionId };
          return manager
            .open(
              {
                cwd,
                ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
              },
              ref,
            )
            .pipe(
              Effect.flatMap((session) => {
                const metadata: Session = {
                  sessionId,
                  projectId,
                  agentSessionId: session.sessionId,
                  createdAt: new Date().toISOString(),
                  cwd,
                  archived: false,
                };
                return repo.write(metadata).pipe(
                  Effect.tapError(() => manager.close(ref)),
                  Effect.andThen(bus.publish({ ref, type: "session.created" })),
                  Effect.andThen(
                    logLifecycle("session.created", "session created", {
                      cwd,
                      agentSessionId: session.sessionId,
                    }),
                  ),
                  Effect.as(ref),
                );
              }),
              inSession(ref),
            );
        }),
      ),

    prepare: (ref, cwd) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.cwd === cwd) return Effect.succeed(metadata);
            const updated = { ...metadata, cwd };
            return repo.write(updated).pipe(Effect.as(updated));
          }),
        ),
      ).pipe(
        Effect.flatMap((metadata) => pi.getSessionInfo(metadata.agentSessionId, cwd)),
        Effect.flatMap((info) =>
          info._tag === "missing"
            ? Effect.fail(new SessionNotResumable({ sessionId: ref.sessionId }))
            : Effect.void,
        ),
        inSession(ref),
      ),

    close: (ref) =>
      resolveAgentSessionId(ref).pipe(
        Effect.andThen(manager.close(ref)),
        Effect.andThen(bus.closeSession(ref, "session_closed")),
        Effect.andThen(logLifecycle("session.closed", "session closed")),
        inSession(ref),
      ),

    delete: (ref) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.andThen(manager.close(ref)),
          Effect.andThen(bus.closeSession(ref, "session_deleted")),
          Effect.andThen(repo.remove(ref.projectId, ref.sessionId)),
          Effect.andThen(bus.publish({ ref, type: "session.deleted" })),
          Effect.andThen(logLifecycle("session.deleted", "session deleted")),
        ),
      ).pipe(inSession(ref)),

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
                      ...(metadata.title !== undefined ? { title: metadata.title } : {}),
                      ...(metadata.updatedAt !== undefined
                        ? { updatedAt: metadata.updatedAt }
                        : {}),
                      ...(status !== undefined ? { status } : {}),
                    }) satisfies SessionSummary,
                ),
              ),
          ),
        ),
      ),

    getMessages: (ref, cwd) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          readHistory(ref, metadata.agentSessionId, cwd).pipe(
            Effect.flatMap((messages) =>
              manager.status(ref).pipe(
                Effect.map((status) => {
                  if (status.activeTurnId === undefined) return messages;
                  for (let index = messages.length - 1; index >= 0; index -= 1) {
                    if (messages[index]?.role === "user") return messages.slice(0, index);
                  }
                  return messages;
                }),
              ),
            ),
          ),
        ),
        inSession(ref),
      ),

    prompt: (input) =>
      Effect.gen(function* () {
        const userInput = yield* toUserInput(input.parts);
        const metadata = yield* readAndStampTitleFromFirstPrompt(input.ref, input.parts);
        const messageId = input.messageId ?? (yield* newSessionId);

        yield* manager.emit(input.ref, {
          type: "session.prompt.submitted",
          messageId,
          parts: input.parts,
        });
        const runtime = yield* manager.ensureRuntime(
          {
            sessionId: metadata.agentSessionId,
            ...(metadata.cwd !== undefined ? { cwd: metadata.cwd } : {}),
          },
          input.ref,
        );
        return yield* runtime.prompt(userInput).pipe(
          Effect.tapError((promptError) =>
            manager.emit(input.ref, {
              type: "session.prompt.rejected",
              messageId,
              reason: promptError.message,
            }),
          ),
        );
      }).pipe(inSession(input.ref)),

    interrupt: (ref) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.peek(ref)),
        Effect.flatMap((runtime) => runtime?.interrupt ?? Effect.void),
        inSession(ref),
      ),

    respondToAgentRequest: (ref, requestId, response) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.peek(ref)),
        Effect.flatMap((runtime) =>
          runtime
            ? runtime.respondToAgentRequest(requestId, response)
            : Effect.fail(new AgentRequestUnavailable({ sessionId: ref.sessionId, requestId })),
        ),
        inSession(ref),
      ),

    getCapabilities: (ref) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.get(ref)),
        Effect.flatMap((runtime) => runtime.getCapabilities),
        inSession(ref),
      ),

    getModelState: (ref, cwd) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          withLiveRuntime(
            ref,
            metadata.agentSessionId,
            cwd,
            (runtime) =>
              runtime.getModelState ??
              Effect.fail(new CapabilityUnsupported({ capability: "getModelState" })),
          ),
        ),
        inSession(ref),
      ),

    setModel: (ref, cwd, model) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          withLiveRuntime(ref, metadata.agentSessionId, cwd, (runtime) =>
            runtime.setModel
              ? runtime.setModel(model)
              : Effect.fail(new CapabilityUnsupported({ capability: "setModel" })),
          ),
        ),
        inSession(ref),
      ),

    getSessionInfo: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) => pi.getSessionInfo(metadata.agentSessionId, metadata.cwd)),
        inSession(ref),
      ),

    getStatus: (ref) => manager.status(ref),
    getSnapshot: (ref) => manager.snapshot(ref),

    resolveRef: (sessionId) =>
      repo.findBySessionId(sessionId).pipe(
        Effect.map(
          (metadata): SessionRef => ({
            projectId: metadata.projectId,
            sessionId: metadata.sessionId,
          }),
        ),
      ),
  } satisfies PiAgentSessionServiceShape;
};

export const PiAgentSessionServiceLayer: Layer.Layer<
  PiAgentSessionService,
  never,
  PiAgentSessionManager | PiAgent | EventBus | Paths | Crypto.Crypto | FileSystem.FileSystem
> = Layer.effect(
  PiAgentSessionService,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const bus = yield* EventBus;
    const paths = yield* Paths;
    const crypto = yield* Crypto.Crypto;
    const repo = yield* makePiAgentSessionRepository(paths.sessionsDir);
    return makePiAgentSessionService({
      manager,
      pi,
      repo,
      bus,
      newSessionId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
        ),
      ),
    });
  }),
);
