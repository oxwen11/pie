import type { SessionRef } from "@getpie/contract";
import { sessionContract, sessionRootContract } from "@getpie/contract/session";
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
import { PiAgentSessionService, type PiAgentSessionServiceShape } from "../harness";
import { buildHandoffParts, HandoffDoesNotFitError } from "../harness/handoff";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { openScopedSubscription } from "./session-stream";
import { streamToAsyncGenerator } from "./stream";

const orpc = implement(sessionContract).$context<RpcContext>();

/** Handler options for a `session.*` procedure; the root shortcuts reuse the same handler. */
type HandlerOptions<K extends keyof typeof sessionRootContract> = Parameters<
  Parameters<(typeof orpc)[K]["effect"]>[0]
>[0];

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

type ProcedureErrors = {
  NOT_FOUND: (input: { message: string }) => unknown;
  CONFLICT: (input: { message: string }) => unknown;
  INVALID_ARGUMENT: (input: { message: string }) => unknown;
  UNSUPPORTED: (input: { message: string }) => unknown;
  INTERNAL: (input: { message: string }) => unknown;
  SESSION_NOT_ACTIVE: (input: { message: string }) => unknown;
};

const mapPromptErrors = (errors: ProcedureErrors) =>
  Effect.catchTags({
    SessionNotFound: (e: { sessionId: string }) =>
      Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
    ProjectNotFound: (e: { projectId: string }) =>
      Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
    StoreReadError: (e: { file: string }) =>
      Effect.fail(errors.INTERNAL({ message: `session store read failed: ${e.file}` })),
    StoreWriteError: (e: { file: string }) =>
      Effect.fail(errors.INTERNAL({ message: `session store write failed: ${e.file}` })),
    HarnessSessionNotFound: (e: { sessionId: string }) =>
      Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is not active` })),
    UnsupportedPromptPart: (e: { kind: string }) =>
      Effect.fail(errors.UNSUPPORTED({ message: `unsupported prompt part: ${e.kind}` })),
    AgentUnavailable: (e: { message: string }) =>
      Effect.fail(errors.UNSUPPORTED({ message: e.message })),
    ExecutableNotFound: (e: { message: string }) =>
      Effect.fail(errors.UNSUPPORTED({ message: e.message })),
    SessionNotResumable: (e: { message: string }) =>
      Effect.fail(errors.INTERNAL({ message: e.message })),
    AgentOpenError: (e: { message: string }) =>
      Effect.fail(errors.INTERNAL({ message: e.message })),
    SessionClosed: (e: { sessionId: string }) =>
      Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
    TurnAlreadyRunning: (e: { sessionId: string }) =>
      Effect.fail(
        errors.CONFLICT({ message: `a turn is already running in session ${e.sessionId}` }),
      ),
    AgentOperationError: (e: { message: string }) =>
      Effect.fail(errors.INTERNAL({ message: e.message })),
  });

const handoffParts = (
  sessions: Pick<PiAgentSessionServiceShape, "getMessages">,
  from: SessionRef,
  prompt: string,
  errors: ProcedureErrors,
) =>
  sessions.getMessages(from).pipe(
    Effect.catchTags({
      ProjectNotFound: (e: { projectId: string }) =>
        Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
      SessionNotFound: (e: { sessionId: string }) =>
        Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      AgentUnavailable: (e: { message: string }) =>
        Effect.fail(errors.UNSUPPORTED({ message: e.message })),
      ExecutableNotFound: (e: { message: string }) =>
        Effect.fail(errors.UNSUPPORTED({ message: e.message })),
      HarnessSessionNotFound: (e: { message: string }) =>
        Effect.fail(errors.INTERNAL({ message: e.message })),
      SessionNotResumable: (e: { message: string }) =>
        Effect.fail(errors.INTERNAL({ message: e.message })),
      AgentOpenError: (e: { message: string }) =>
        Effect.fail(errors.INTERNAL({ message: e.message })),
      SessionClosed: (e: { sessionId: string }) =>
        Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
      AgentOperationError: (e: { message: string }) =>
        Effect.fail(errors.INTERNAL({ message: e.message })),
    }),
    Effect.flatMap((messages) =>
      Effect.try({
        try: () => buildHandoffParts(messages, prompt),
        catch: (error) =>
          error instanceof HandoffDoesNotFitError
            ? errors.INVALID_ARGUMENT({ message: error.message })
            : errors.INTERNAL({ message: "handoff failed" }),
      }),
    ),
  );

const runHandler = function* ({ input, errors }: HandlerOptions<"run">) {
  if ((input.provider === undefined) !== (input.modelId === undefined)) {
    return yield* Effect.fail(
      errors.INVALID_ARGUMENT({ message: "provider and modelId must be passed together" }),
    );
  }
  const projects = yield* ProjectService;
  const sessions = yield* PiAgentSessionService;
  const parts =
    input.from === undefined
      ? [{ type: "text" as const, text: input.prompt }]
      : yield* handoffParts(sessions, input.from, input.prompt, errors);
  const created = yield* projects.findById(input.projectId).pipe(
    Effect.flatMap((project) =>
      sessions.create({
        projectId: input.projectId,
        cwd: project.path,
        ...(input.provider !== undefined && input.modelId !== undefined
          ? { model: { provider: input.provider, modelId: input.modelId } }
          : undefined),
        ...(input.worktree !== undefined ? { worktree: input.worktree } : undefined),
      }),
    ),
    Effect.catchTags({
      ProjectNotFound: (e) =>
        Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
    }),
    mapGitWorktreeErrors(errors),
  );
  const sent = yield* sessions
    .prompt({ ref: created.ref, parts })
    .pipe(mapPromptErrors(errors), mapGitWorktreeErrors(errors));
  return { ref: created.ref, turnId: sent.turnId, workspace: created.workspace };
};

const sendHandler = function* ({ input, errors }: HandlerOptions<"send">) {
  const sessions = yield* PiAgentSessionService;
  return yield* sessions.prompt(input).pipe(mapPromptErrors(errors), mapGitWorktreeErrors(errors));
};

const lsHandler = function* ({ input, errors }: HandlerOptions<"ls">) {
  const projects = yield* ProjectService;
  const sessions = yield* PiAgentSessionService;
  return yield* projects.findById(input.projectId).pipe(
    Effect.andThen(sessions.list(input.projectId, input.archived ?? false)),
    Effect.catchTags({
      ProjectNotFound: (e) =>
        Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
    }),
  );
};

const logsHandler = function* ({ input, errors }: HandlerOptions<"logs">) {
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
      HarnessSessionNotFound: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      SessionClosed: (e) =>
        Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
      AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
    }),
  );
};

const waitHandler = function* ({ input }: HandlerOptions<"wait">) {
  const sessions = yield* PiAgentSessionService;
  const deadline = Date.now() + (input.timeoutSeconds ?? 20) * 1000;
  for (;;) {
    const snapshot = yield* sessions.getSnapshot(input.ref);
    const pending = snapshot.pendingRequests[0];
    if (pending !== undefined) return { state: "request" as const, requestId: pending.id };
    if (snapshot.status.phase === "crashed") return { state: "crashed" as const };
    const running =
      snapshot.status.phase === "running" || snapshot.status.activeTurnId !== undefined;
    if (!running) return { state: "idle" as const };
    if (Date.now() >= deadline) return { state: "running" as const };
    yield* Effect.sleep(400);
  }
};

const interruptHandler = function* ({ input, errors }: HandlerOptions<"interrupt">) {
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
};

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
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
      }),
      mapGitWorktreeErrors(errors),
    );
  }),
  prepare: orpc.prepare.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.prepare(input.ref).pipe(
      Effect.map((workspace) => ({ ref: input.ref, workspace })),
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        WorktreeCheckoutMissing: (e) =>
          Effect.fail(
            errors.WORKTREE_MISSING({
              data: { sessionId: e.sessionId, projectId: e.projectId, branch: e.branch },
            }),
          ),
      }),
      mapGitWorktreeErrors(errors),
    );
  }),
  restoreWorktree: orpc.restoreWorktree.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.restoreWorktree(input.ref).pipe(
      Effect.map((workspace) => ({ ref: input.ref, workspace })),
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        SessionNotWorktree: (e) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `session ${e.sessionId} is not a worktree session`,
            }),
          ),
      }),
      mapGitWorktreeErrors(errors),
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

  ls: orpc.ls.effect(lsHandler),
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
  transcriptPath: orpc.transcriptPath.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.transcriptPath(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        StoreReadError: () =>
          Effect.fail(errors.INTERNAL({ message: "Could not read the transcript directory" })),
      }),
    );
  }),
  logs: orpc.logs.effect(logsHandler),
  resolveRef: orpc.resolveRef.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return yield* sessions.resolveRef(input.sessionId).pipe(
      Effect.catchTags({
        SessionRefNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
      }),
    );
  }),

  handoff: orpc.handoff.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    return { parts: yield* handoffParts(sessions, input.from, input.prompt, errors) };
  }),
  run: orpc.run.effect(runHandler),
  wait: orpc.wait.effect(waitHandler),
  send: orpc.send.effect(sendHandler),
  interrupt: orpc.interrupt.effect(interruptHandler),
  reload: orpc.reload.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.reload(input.ref).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  queue: orpc.queue.effect(function* ({ input, errors }) {
    const sessions = yield* PiAgentSessionService;
    yield* sessions.replaceQueue(input).pipe(
      Effect.catchTags({
        SessionNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${e.sessionId} not found` })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  respond: orpc.respond.effect(function* ({ input, errors }) {
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
        HarnessSessionNotFound: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionNotResumable: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        AgentOpenError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        SessionClosed: (e) =>
          Effect.fail(errors.SESSION_NOT_ACTIVE({ message: `session ${e.sessionId} is closed` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  model: orpc.model.effect(function* ({ input, errors }) {
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

const root = implement(sessionRootContract).$context<RpcContext>();

export const sessionRootRouter = root.router({
  run: root.run.effect(runHandler),
  send: root.send.effect(sendHandler),
  ls: root.ls.effect(lsHandler),
  logs: root.logs.effect(logsHandler),
  wait: root.wait.effect(waitHandler),
  interrupt: root.interrupt.effect(interruptHandler),
});
