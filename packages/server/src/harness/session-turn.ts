import type {
  AgentModelState,
  AgentResponse,
  PromptInput,
  SessionCapabilities,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
} from "@getpie/contract";
import type { UIMessage } from "ai";
import { Context, Crypto, Effect, Layer } from "effect";

import {
  type ProjectNotFound,
  type SessionNotFound,
  type StoreReadError,
  type StoreWriteError,
  UnsupportedPromptPart,
} from "../errors";
import {
  AgentRequestUnavailable,
  type AgentOperationError,
  type CapabilityUnsupported,
  type HarnessSessionNotFound,
  type ResumeSessionError,
  type SessionClosed,
  type TurnAlreadyRunning,
} from "./errors";
import { PiAgent } from "./pi/agent";
import type { PiAgentRuntime } from "./pi/runtime";
import type { SessionInfoResult } from "./pi/types";
import { inSession } from "./session-identity";
import type { PromptReceipt, RuntimePromptReceipt, UserInput } from "./session-io";
import { SessionMetadataLocks } from "./session-locks";
import { PiAgentSessionManager } from "./session-manager";
import { modelStateFromMetadata, SessionMetadata, type SessionWithCwd } from "./session-metadata";
import { PiAgentSessionRepository } from "./session-repository";

const toUserInput = (
  parts: PromptInput["parts"],
  delivery: PromptInput["delivery"],
): Effect.Effect<UserInput, UnsupportedPromptPart> =>
  Effect.forEach(parts, (part) =>
    part.type === "file"
      ? Effect.fail(new UnsupportedPromptPart({ kind: "file" }))
      : Effect.succeed(part),
  ).pipe(
    Effect.map((userParts) => {
      const userInput: UserInput = { parts: userParts };
      if (delivery === undefined) return userInput;
      return { ...userInput, delivery };
    }),
  );

export type SessionTurnShape = {
  readonly getMessages: (
    ref: SessionRef,
  ) => Effect.Effect<
    ReadonlyArray<UIMessage>,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly prompt: (
    input: PromptInput,
  ) => Effect.Effect<
    PromptReceipt,
    | SessionNotFound
    | StoreReadError
    | StoreWriteError
    | ProjectNotFound
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
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly setModel: (
    ref: SessionRef,
    model: { readonly provider: string; readonly modelId: string },
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly getSessionInfo: (
    ref: SessionRef,
  ) => Effect.Effect<
    SessionInfoResult,
    SessionNotFound | ProjectNotFound | StoreReadError | StoreWriteError | AgentOperationError
  >;
  readonly getStatus: (ref: SessionRef) => Effect.Effect<SessionStatus>;
  readonly getSnapshot: (ref: SessionRef) => Effect.Effect<SessionRuntimeSnapshot>;
};

export class SessionTurn extends Context.Service<SessionTurn, SessionTurnShape>()("SessionTurn") {}

export const SessionTurnLayer: Layer.Layer<
  SessionTurn,
  never,
  | PiAgentSessionManager
  | PiAgent
  | PiAgentSessionRepository
  | SessionMetadata
  | SessionMetadataLocks
  | Crypto.Crypto
> = Layer.effect(
  SessionTurn,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const repo = yield* PiAgentSessionRepository;
    const sessionMetadata = yield* SessionMetadata;
    const locks = yield* SessionMetadataLocks;
    const crypto = yield* Crypto.Crypto;
    const { readMetadata, ensureCwd, readAndStampTitleFromFirstPrompt } = sessionMetadata;
    const withMetadataMutation = locks.withLock;
    const newSessionId = crypto.randomUUIDv4.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
      ),
    );

    const ensureRuntimeForPrompt = (
      ref: SessionRef,
      metadata: SessionWithCwd,
    ): Effect.Effect<
      PiAgentRuntime,
      ResumeSessionError | StoreReadError | StoreWriteError | AgentOperationError
    > =>
      Effect.gen(function* () {
        const existing = yield* manager.peek(ref);
        if (existing) return existing;

        if (metadata.agentSessionId === undefined) {
          const runtime = yield* manager.open(
            {
              cwd: metadata.cwd,
              ...(metadata.provider !== undefined ? { provider: metadata.provider } : undefined),
              ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : undefined),
            },
            ref,
          );
          yield* repo.write({ ...metadata, agentSessionId: runtime.sessionId });
          return runtime;
        }

        return yield* manager.ensureRuntime(
          { sessionId: metadata.agentSessionId, cwd: metadata.cwd },
          ref,
        );
      });

    const deliverPrompt = (
      ref: SessionRef,
      userInput: UserInput,
    ): Effect.Effect<
      RuntimePromptReceipt,
      | ResumeSessionError
      | StoreReadError
      | StoreWriteError
      | AgentOperationError
      | ProjectNotFound
      | SessionNotFound
      | SessionClosed
      | TurnAlreadyRunning
    > =>
      Effect.gen(function* () {
        const resolved = yield* readMetadata(ref).pipe(Effect.flatMap(ensureCwd));
        const runtime = yield* ensureRuntimeForPrompt(ref, resolved);
        return yield* runtime.prompt(userInput);
      });

    const readHistory = (
      ref: SessionRef,
      agentSessionId: string,
      cwd: string,
    ): Effect.Effect<
      ReadonlyArray<UIMessage>,
      ResumeSessionError | SessionClosed | AgentOperationError
    > => {
      const cold = pi.getMessages;
      if (cold) return cold(agentSessionId, cwd);
      return manager
        .ensureRuntime({ sessionId: agentSessionId, cwd }, ref)
        .pipe(Effect.flatMap((runtime) => runtime.getMessages));
    };

    const runtimeInput = (agentSessionId: string, cwd: string) => ({
      sessionId: agentSessionId,
      cwd,
    });

    const withLiveRuntime = <A, E>(
      ref: SessionRef,
      agentSessionId: string,
      cwd: string,
      run: (runtime: PiAgentRuntime) => Effect.Effect<A, SessionClosed | AgentOperationError | E>,
    ): Effect.Effect<A, ResumeSessionError | SessionClosed | AgentOperationError | E> =>
      manager.ensureRuntime(runtimeInput(agentSessionId, cwd), ref).pipe(Effect.flatMap(run));

    return {
      getMessages: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed<ReadonlyArray<UIMessage>>([]);
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) =>
                readHistory(ref, agentSessionId, resolved.cwd).pipe(
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
            );
          }),
          inSession(ref),
        ),

      prompt: (input: PromptInput) =>
        Effect.gen(function* () {
          const queued = input.delivery !== undefined;
          const userInput = yield* toUserInput(input.parts, input.delivery);
          yield* readAndStampTitleFromFirstPrompt(input.ref, input.parts);
          const messageId = input.messageId ?? (yield* newSessionId);

          const submitted = () =>
            manager.emit(input.ref, {
              type: "session.prompt.submitted",
              messageId,
              parts: input.parts,
            });

          const reject = (reason: string) =>
            manager.emit(input.ref, {
              type: "session.prompt.rejected",
              messageId,
              reason,
            });

          // Idle: fire-and-forget so `submitted` still precedes `turn.started`.
          // Queued: await the harness — a failed follow-up must fail the RPC
          // (nothing was submitted, so there is no `rejected` to compensate).
          if (!queued) {
            const turnId = yield* newSessionId;
            yield* submitted();
            yield* deliverPrompt(input.ref, userInput).pipe(
              Effect.catch((error: unknown) =>
                reject(error instanceof Error ? error.message : String(error)),
              ),
              Effect.forkDetach,
            );
            return { turnId, started: true };
          }

          const receipt = yield* deliverPrompt(input.ref, userInput);
          if (receipt.started) yield* submitted();
          return { turnId: receipt.turnId, started: receipt.started };
        }).pipe(inSession(input.ref)),

      interrupt: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.peek(ref)),
          Effect.flatMap((runtime) => runtime?.interrupt ?? Effect.void),
          inSession(ref),
        ),

      respondToAgentRequest: (ref: SessionRef, requestId: string, response: AgentResponse) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.peek(ref)),
          Effect.flatMap((runtime) =>
            runtime
              ? runtime.respondToAgentRequest(requestId, response)
              : Effect.fail(new AgentRequestUnavailable({ sessionId: ref.sessionId, requestId })),
          ),
          inSession(ref),
        ),

      getCapabilities: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.get(ref)),
          Effect.flatMap((runtime) => runtime.getCapabilities),
          inSession(ref),
        ),

      getModelState: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed(modelStateFromMetadata(metadata));
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) =>
                withLiveRuntime(
                  ref,
                  agentSessionId,
                  resolved.cwd,
                  (runtime) => runtime.getModelState,
                ),
              ),
            );
          }),
          inSession(ref),
        ),

      setModel: (ref: SessionRef, model: { readonly provider: string; readonly modelId: string }) =>
        withMetadataMutation(
          ref,
          readMetadata(ref).pipe(
            Effect.flatMap((metadata) => {
              const persistModel = repo.write({
                ...metadata,
                provider: model.provider,
                modelId: model.modelId,
              });
              if (metadata.agentSessionId === undefined) {
                return persistModel.pipe(Effect.as(model satisfies AgentModelState));
              }
              const agentSessionId = metadata.agentSessionId;
              return ensureCwd(metadata).pipe(
                Effect.flatMap((resolved) =>
                  persistModel.pipe(
                    Effect.andThen(
                      withLiveRuntime(ref, agentSessionId, resolved.cwd, (runtime) =>
                        runtime.setModel(model),
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ).pipe(inSession(ref)),

      getSessionInfo: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed<SessionInfoResult>({ _tag: "unsupported" });
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) => pi.getSessionInfo(agentSessionId, resolved.cwd)),
            );
          }),
          inSession(ref),
        ),

      getStatus: (ref: SessionRef) => manager.status(ref),
      getSnapshot: (ref: SessionRef) => manager.snapshot(ref),
    } satisfies SessionTurnShape;
  }),
);
