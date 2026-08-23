import "@orpc/experimental-effect/extensions/effect";
import { sessionContract } from "@getpie/contract/session";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { EventBus } from "../events";
import { GitService } from "../git";
import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { openScopedSubscription } from "./session-stream";
import { streamToAsyncGenerator } from "./stream";

const orpc = implement(sessionContract).$context<RpcContext>();

const sessionWorkspace = (
  ref: { readonly projectId: string; readonly sessionId: string },
  projectPath: string,
) =>
  Effect.gen(function* () {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.workspaceFor(ref, projectPath);
  });

export const sessionRouter = orpc.router({
  create: orpc.create.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const git = yield* GitService;
    const model =
      input.provider && input.modelId
        ? { provider: input.provider, modelId: input.modelId }
        : undefined;

    return yield* projects.findById(input.projectId).pipe(
      Effect.flatMap((project) =>
        Effect.gen(function* () {
          let sessionCwd = project.path;
          let gitBranch: string | undefined;
          let createdWorktreePath: string | undefined;

          if (input.worktree !== undefined) {
            const worktree = yield* git
              .worktreeCreate(
                project.path,
                input.worktree.branch !== undefined ? { branch: input.worktree.branch } : undefined,
              )
              .pipe(
                Effect.tap((result) => {
                  createdWorktreePath = result.path;
                  return Effect.void;
                }),
              );
            sessionCwd = worktree.path;
            gitBranch = worktree.branch;
          }

          const ref = yield* sessions
            .create(input.projectId, sessionCwd, model, gitBranch)
            .pipe(
              Effect.tapError(() =>
                createdWorktreePath === undefined
                  ? Effect.void
                  : git.worktreeRemove(createdWorktreePath).pipe(Effect.ignore),
              ),
            );

          return {
            ref,
            workspace: {
              cwd: sessionCwd,
              ...(gitBranch === undefined ? {} : { gitBranch }),
            },
          };
        }),
      ),
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        GitNotRepository: () =>
          Effect.fail(errors.UNSUPPORTED({ message: "project is not a git repository" })),
        GitInvalidBranchName: (e) =>
          Effect.fail(errors.UNSUPPORTED({ message: `invalid branch name: ${e.branch}` })),
        GitBranchExists: (e) =>
          Effect.fail(errors.CONFLICT({ message: `branch already exists: ${e.branch}` })),
        GitWorktreePathExists: (e) =>
          Effect.fail(errors.CONFLICT({ message: `worktree path already exists: ${e.path}` })),
        WorkspacePathEscape: () =>
          Effect.fail(
            errors.UNSUPPORTED({ message: "worktree path escapes managed worktree directory" }),
          ),
        WorkspaceNotDirectory: () =>
          Effect.fail(errors.UNSUPPORTED({ message: "project path is not a directory" })),
        GitError: () => Effect.fail(errors.INTERNAL({ message: "git worktree creation failed" })),
        AgentUnavailable: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        ExecutableNotFound: (e) => Effect.fail(errors.UNSUPPORTED({ message: e.message })),
        AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  prepare: orpc.prepare.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    return yield* projects.findById(input.ref.projectId).pipe(
      Effect.flatMap((project) =>
        sessions.prepare(input.ref, project.path).pipe(
          Effect.map((workspace) => ({
            ref: input.ref,
            workspace,
          })),
        ),
      ),
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
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
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    return yield* projects.findById(input.ref.projectId).pipe(
      Effect.flatMap((project) =>
        sessionWorkspace(input.ref, project.path).pipe(
          Effect.flatMap((workspace) => sessions.getMessages(input.ref, workspace.cwd)),
        ),
      ),
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
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    return yield* projects.findById(input.ref.projectId).pipe(
      Effect.flatMap((project) =>
        sessionWorkspace(input.ref, project.path).pipe(
          Effect.flatMap((workspace) => sessions.getModelState(input.ref, workspace.cwd)),
        ),
      ),
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
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    return yield* projects.findById(input.ref.projectId).pipe(
      Effect.flatMap((project) =>
        sessionWorkspace(input.ref, project.path).pipe(
          Effect.flatMap((workspace) =>
            sessions.setModel(input.ref, workspace.cwd, {
              provider: input.provider,
              modelId: input.modelId,
            }),
          ),
        ),
      ),
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
