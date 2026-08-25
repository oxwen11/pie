import "@orpc/experimental-effect/extensions/effect";
import { sessionContract } from "@getpie/contract/session";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import {
  GitBranchExists,
  GitError,
  GitInvalidBranchName,
  GitInvalidWorktreeKey,
  GitNotRepository,
  GitRefNotFound,
  GitWorktreePathExists,
  WorkspaceNotDirectory,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import { EventBus } from "../events";
import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { openScopedSubscription } from "./session-stream";
import { streamToAsyncGenerator } from "./stream";

const orpc = implement(sessionContract).$context<RpcContext>();

const mapGitWorktreeErrors = <
  E extends {
    NOT_FOUND: (input: { message: string }) => unknown;
    CONFLICT: (input: { message: string }) => unknown;
    INVALID_ARGUMENT: (input: { message: string }) => unknown;
    FORBIDDEN: (input: { message: string }) => unknown;
    INTERNAL: (input: { message: string }) => unknown;
  },
>(
  errors: E,
) =>
  Effect.catchTags({
    GitRefNotFound: (e: GitRefNotFound) =>
      Effect.fail(errors.NOT_FOUND({ message: `git ref ${e.ref} not found` })),
    GitBranchExists: (e: GitBranchExists) =>
      Effect.fail(errors.CONFLICT({ message: `branch ${e.branch} already exists` })),
    GitWorktreePathExists: (e: GitWorktreePathExists) =>
      Effect.fail(errors.CONFLICT({ message: `worktree path ${e.path} already exists` })),
    GitInvalidBranchName: (e: GitInvalidBranchName) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `invalid branch name ${e.branch}` })),
    GitInvalidWorktreeKey: (e: GitInvalidWorktreeKey) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `invalid worktree key ${e.worktreeKey}` })),
    GitNotRepository: (e: GitNotRepository) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `${e.cwd} is not a git repository` })),
    WorkspacePathEscape: (e: WorkspacePathEscape) =>
      Effect.fail(errors.FORBIDDEN({ message: `path ${e.path} escapes ${e.cwd}` })),
    WorkspaceNotDirectory: (e: WorkspaceNotDirectory) =>
      Effect.fail(errors.INVALID_ARGUMENT({ message: `${e.path} is not a directory` })),
    WorkspaceReadError: (e: WorkspaceReadError) =>
      Effect.fail(errors.INTERNAL({ message: `failed to read ${e.path}` })),
    GitError: (e: GitError) => Effect.fail(errors.INTERNAL({ message: `git failed in ${e.cwd}` })),
  });

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
          ...(model !== undefined ? { model } : {}),
          ...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
        }),
      ),
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
      }),
      mapGitWorktreeErrors(errors),
    );
  }),
  prepare: orpc.prepare.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    const preparedWorkspace = yield* sessions.prepare(input.ref).pipe(
      Effect.map((sessionWorkspace) => ({
        ref: input.ref,
        workspace: sessionWorkspace,
      })),
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
    return preparedWorkspace;
  }),
  close: orpc.close.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.close(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),

  list: orpc.list.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    return yield* projects.findById(input.projectId).pipe(
      Effect.andThen(sessions.list(input.projectId, input.archived ?? false)),
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
      }),
    );
  }),
  rename: orpc.rename.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.rename(input.ref, input.title).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),
  archive: orpc.archive.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.archive(input.ref, input.archived).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),
  delete: orpc.delete.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.delete(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),
  getMessages: orpc.getMessages.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.getMessages(input.ref).pipe(
      Effect.map((messages) => ({ messages })),
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        AgentUnavailable: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        ExecutableNotFound: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        CapabilityUnsupported: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        HarnessSessionNotFound: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  resolveRef: orpc.resolveRef.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.resolveRef(input.sessionId).pipe(
      Effect.catchTags({
        SessionRefNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),

  prompt: orpc.prompt.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.prompt(input).pipe(
      Effect.catchTags({
        // Metadata gone → NOT_FOUND; native session not open → SESSION_NOT_ACTIVE.
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        HarnessSessionNotFound: (e) =>
          Effect.fail(
            errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is not active` }),
          ),
        UnsupportedPromptPart: (e) =>
          Effect.fail(errors.UNSUPPORTED({ message: `unsupported prompt part: ${e.kind}` })),
        AgentUnavailable: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        ExecutableNotFound: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        TurnAlreadyRunning: (e) =>
          Effect.fail(
            errors.CONFLICT({ message: `a turn is already running in session ${e.sessionId}` }),
          ),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  interrupt: orpc.interrupt.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.interrupt(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  respondToAgentRequest: orpc.respondToAgentRequest.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.respondToAgentRequest(input.ref, input.requestId, input.response).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        AgentRequestUnavailable: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `request ${e.requestId} is not pending` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
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
    return yield* sessions.getModelState(input.ref).pipe(
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        AgentUnavailable: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        ExecutableNotFound: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        CapabilityUnsupported: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        HarnessSessionNotFound: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  setModel: orpc.setModel.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions
      .setModel(input.ref, {
        provider: input.provider,
        modelId: input.modelId,
      })
      .pipe(
        Effect.catchTags({
          ProjectNotFound: (e) =>
            Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
          SessionNotFound: (e) =>
            Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
          AgentUnavailable: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
          ExecutableNotFound: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
          CapabilityUnsupported: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
          HarnessSessionNotFound: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
          SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
          AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
          SessionClosed: (e) =>
            Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
          AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        }),
      );
  }),

  subscribe: orpc.subscribe.effect(function* ({ input }) {
    const bus = yield* EventBus;
    const stream = yield* openScopedSubscription(bus, input.scope);
    return streamToAsyncGenerator(stream);
  }),
});

export type SessionRouter = typeof sessionRouter;
