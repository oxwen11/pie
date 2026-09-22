import { sessionContract } from "@getpie/contract/session";
import { Effect } from "effect";

import { EventBus } from "../events";
import { PiAgentSessionService } from "../harness";
import { SessionMetadata } from "../harness/session-metadata";
import { ProjectService } from "../project";
import { TerminalManager } from "../terminal";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { openScopedSubscription } from "./session-stream";
import { streamToAsyncGenerator } from "./stream";
import {
  agentOperation,
  catchGitWorktree,
  catchLiveAgent,
  projectNotFound,
  resumeFailures,
  sessionClosed,
  sessionNotFound,
  sessionStoreFailures,
  unsupportedExecutable,
} from "./wire";

const orpc = implement(sessionContract).$context<RpcContext>();

export const sessionRouter = orpc.router({
  create: orpc.create.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const model =
      input.provider && input.modelId
        ? { provider: input.provider, modelId: input.modelId }
        : undefined;

    return yield* projects.findById(input.projectId).pipe(
      Effect.flatMap((project) =>
        sessions.create({
          projectId: input.projectId,
          cwd: project.path,
          ...(model !== undefined ? { model } : undefined),
          ...(input.worktree !== undefined ? { worktree: input.worktree } : undefined),
        }),
      ),
      Effect.catchTags({
        ProjectNotFound: projectNotFound(errors),
      }),
      catchGitWorktree(errors),
    );
  }),
  prepare: orpc.prepare.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.prepare(input.ref).pipe(
      Effect.map((workspace) => ({ ref: input.ref, workspace })),
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
        ProjectNotFound: projectNotFound(errors),
        SessionNotResumable: resumeFailures(errors).SessionNotResumable,
        AgentOperationError: agentOperation(errors),
        WorktreeCheckoutMissing: (error) =>
          Effect.fail(
            errors.WORKTREE_MISSING({
              data: {
                sessionId: error.sessionId,
                projectId: error.projectId,
                branch: error.branch,
              },
            }),
          ),
      }),
      catchGitWorktree(errors),
    );
  }),
  restoreWorktree: orpc.restoreWorktree.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.restoreWorktree(input.ref).pipe(
      Effect.map((workspace) => ({ ref: input.ref, workspace })),
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
        ProjectNotFound: projectNotFound(errors),
        SessionNotWorktree: (error) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `session ${error.sessionId} is not a worktree session`,
            }),
          ),
      }),
      catchGitWorktree(errors),
    );
  }),
  close: orpc.close.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.close(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
      }),
    );
  }),

  list: orpc.list.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const metadata = yield* SessionMetadata;
    return yield* projects.findById(input.projectId).pipe(
      Effect.andThen(metadata.list(input.projectId, input.archived ?? false)),
      Effect.catchTags({
        ProjectNotFound: projectNotFound(errors),
      }),
    );
  }),
  rename: orpc.rename.effect(function* ({ input, errors }) {
    const metadata = yield* SessionMetadata;
    yield* metadata.rename(input.ref, input.title).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
      }),
    );
  }),
  archive: orpc.archive.effect(function* ({ input, errors }) {
    const metadata = yield* SessionMetadata;
    yield* metadata.archive(input.ref, input.archived).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
      }),
    );
  }),
  delete: orpc.delete.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    const terminals = yield* TerminalManager;
    yield* sessions.delete(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
      }),
    );
    yield* terminals.closeAll(input.ref);
  }),
  getMessages: orpc.getMessages.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.getMessages(input.ref).pipe(
      Effect.map((messages) => ({ messages })),
      catchLiveAgent(errors),
    );
  }),
  resolveRef: orpc.resolveRef.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.resolveRef(input.sessionId).pipe(
      Effect.catchTags({
        SessionRefNotFound: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${error.sessionId} not found` })),
      }),
    );
  }),

  prompt: orpc.prompt.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.prompt(input).pipe(
      Effect.catchTags({
        // Metadata gone → NOT_FOUND; native session not open → SESSION_NOT_ACTIVE.
        SessionNotFound: sessionNotFound(errors),
        ProjectNotFound: projectNotFound(errors),
        ...sessionStoreFailures(errors),
        HarnessSessionNotFound: (error) =>
          Effect.fail(
            errors.SESSION_NOT_ACTIVE({ message: `session ${error.sessionId} is not active` }),
          ),
        UnsupportedPromptPart: (error) =>
          Effect.fail(errors.UNSUPPORTED({ message: `unsupported prompt part: ${error.kind}` })),
        ...unsupportedExecutable(errors),
        SessionNotResumable: resumeFailures(errors).SessionNotResumable,
        AgentOpenError: resumeFailures(errors).AgentOpenError,
        SessionClosed: sessionClosed(errors),
        TurnAlreadyRunning: (error) =>
          Effect.fail(
            errors.CONFLICT({ message: `a turn is already running in session ${error.sessionId}` }),
          ),
        AgentOperationError: agentOperation(errors),
      }),
      catchGitWorktree(errors),
    );
  }),
  interrupt: orpc.interrupt.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.interrupt(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
        SessionClosed: sessionClosed(errors),
        AgentOperationError: agentOperation(errors),
      }),
    );
  }),
  replaceQueue: orpc.replaceQueue.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.replaceQueue(input).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
        SessionClosed: sessionClosed(errors),
        AgentOperationError: agentOperation(errors),
      }),
    );
  }),
  respondToAgentRequest: orpc.respondToAgentRequest.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.respondToAgentRequest(input.ref, input.requestId, input.response).pipe(
      Effect.catchTags({
        SessionNotFound: sessionNotFound(errors),
        AgentRequestUnavailable: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `request ${error.requestId} is not pending` })),
        AgentOperationError: agentOperation(errors),
      }),
    );
  }),
  // Untouched persisted sessions read idle — not SESSION_NOT_ACTIVE.
  getStatus: orpc.getStatus.effect(function* ({ input }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.getStatus(input.ref);
  }),
  getSnapshot: orpc.getSnapshot.effect(function* ({ input }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.getSnapshot(input.ref);
  }),

  getModelState: orpc.getModelState.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.getModelState(input.ref).pipe(catchLiveAgent(errors));
  }),
  setModel: orpc.setModel.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions
      .setModel(input.ref, {
        provider: input.provider,
        modelId: input.modelId,
      })
      .pipe(catchLiveAgent(errors));
  }),

  subscribe: orpc.subscribe.effect(function* ({ input }) {
    const bus = yield* EventBus;
    const stream = yield* openScopedSubscription(bus, input.scope);
    return streamToAsyncGenerator(stream);
  }),
});

export type SessionRouter = typeof sessionRouter;
