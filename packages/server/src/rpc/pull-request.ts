import type { SessionRef } from "@getpie/contract";
import type { PullRequestRef } from "@getpie/contract/pull-request";
import { pullRequestContract, pullRequestKey } from "@getpie/contract/pull-request";
import { Effect } from "effect";

import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { PullRequestService } from "../pull-request";
import { PullRequestCoordinator } from "../pull-request/coordinator";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { resolveWorkspaceCwdOrFail } from "./resolve-workspace";

const orpc = implement(pullRequestContract).$context<RpcContext>();

type PullRequestReadErrors = {
  MISSING_GH: (input: { message: string }) => unknown;
  UNAUTHENTICATED: (input: { message: string }) => unknown;
  RATE_LIMITED: (input: { message: string }) => unknown;
  UNSUPPORTED_CONTEXT: (input: { message: string }) => unknown;
  HOST_UNAVAILABLE: (input: { message: string }) => unknown;
  INVALID_RESPONSE: (input: { message: string }) => unknown;
};

const pullRequestReadErrorHandlers = <E extends PullRequestReadErrors>(errors: E) => ({
  PullRequestMissingGh: () =>
    Effect.fail(errors.MISSING_GH({ message: "GitHub CLI is not installed" })),
  PullRequestUnauthenticated: () =>
    Effect.fail(errors.UNAUTHENTICATED({ message: "GitHub CLI is not authenticated" })),
  PullRequestRateLimited: () =>
    Effect.fail(errors.RATE_LIMITED({ message: "GitHub rate limit reached" })),
  PullRequestUnsupportedContext: () =>
    Effect.fail(
      errors.UNSUPPORTED_CONTEXT({ message: "The current Git workspace is unsupported" }),
    ),
  PullRequestHostUnavailable: () =>
    Effect.fail(errors.HOST_UNAVAILABLE({ message: "GitHub is unavailable" })),
  PullRequestInvalidResponse: () =>
    Effect.fail(errors.INVALID_RESPONSE({ message: "GitHub returned an invalid response" })),
});

const catchCurrentRead = <E extends PullRequestReadErrors>(errors: E) =>
  Effect.catchTags(pullRequestReadErrorHandlers(errors));

const resolveLinkedCwd = <
  E extends {
    SESSION_NOT_FOUND: (input: { data: { message: string } }) => unknown;
    STALE_CONTEXT: (input: { message: string }) => unknown;
  },
>(
  ref: SessionRef,
  pullRequest: PullRequestRef,
  errors: E,
) =>
  Effect.gen(function* () {
    const sessions = yield* PiAgentSessionService;
    const projects = yield* ProjectService;
    const links = yield* sessions
      .pullRequestsFor(ref)
      .pipe(
        Effect.catch(() =>
          Effect.fail(errors.SESSION_NOT_FOUND({ data: { message: "Session is unavailable" } })),
        ),
      );
    if (
      !links.some(
        (link) => !link.excluded && pullRequestKey(link.ref) === pullRequestKey(pullRequest),
      )
    )
      return yield* Effect.fail(
        errors.STALE_CONTEXT({ message: "Pull request is not associated with this Session" }),
      );
    return yield* projects.findById(ref.projectId).pipe(
      Effect.map((project) => project.path),
      Effect.catch(() =>
        Effect.fail(errors.SESSION_NOT_FOUND({ data: { message: "Project is unavailable" } })),
      ),
    );
  });

const catchAction = <
  E extends PullRequestReadErrors & {
    STALE_CONTEXT: (input: { message: string }) => unknown;
    UNSUPPORTED_ACTION: (input: { message: string }) => unknown;
    OUTCOME_UNKNOWN: (input: { message: string }) => unknown;
    HOST_REJECTED: (input: { message: string }) => unknown;
  },
>(
  errors: E,
) =>
  Effect.catchTags({
    ...pullRequestReadErrorHandlers(errors),
    PullRequestStaleContext: () =>
      Effect.fail(errors.STALE_CONTEXT({ message: "Pull request context changed" })),
    PullRequestUnsupportedAction: () =>
      Effect.fail(
        errors.UNSUPPORTED_ACTION({
          message: "This GitHub CLI version cannot safely perform the action",
        }),
      ),
    PullRequestActionOutcomeUnknown: () =>
      Effect.fail(
        errors.OUTCOME_UNKNOWN({
          message: "Could not confirm whether GitHub applied the action",
        }),
      ),
    PullRequestHostRejected: () =>
      Effect.fail(errors.HOST_REJECTED({ message: "GitHub rejected the action" })),
  });

export const pullRequestRouter = orpc.router({
  current: orpc.current.effect(function* ({ input, errors }) {
    const cwd = yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors);
    return yield* (yield* PullRequestService).current(cwd).pipe(catchCurrentRead(errors));
  }),
  diff: orpc.diff.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    if ("pullRequest" in input) {
      return yield* service.diffFor(input.pullRequest).pipe(catchCurrentRead(errors));
    }
    const cwd = yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors);
    return yield* service.diff(cwd).pipe(catchCurrentRead(errors));
  }),
  statuses: orpc.statuses.effect(function* ({ input }) {
    return yield* (yield* PullRequestCoordinator).statuses(input.refs);
  }),
  demand: orpc.demand.effect(function* ({ input, errors }) {
    return yield* (yield* PullRequestCoordinator)
      .demand(input)
      .pipe(
        Effect.catchTag("InvalidPullRequestLease", () =>
          Effect.fail(errors.INVALID_LEASE({ message: "Demand lease is invalid or expired" })),
        ),
      );
  }),
  refresh: orpc.refresh.effect(function* ({ input }) {
    return yield* (yield* PullRequestCoordinator).refresh(input.ref);
  }),
  exclude: orpc.exclude.effect(function* ({ input, errors }) {
    return yield* (yield* PiAgentSessionService)
      .excludePullRequest(input.ref, input.pullRequest)
      .pipe(
        Effect.catchTags({
          SessionNotFound: () =>
            Effect.fail(errors.SESSION_NOT_FOUND({ data: { message: "Session is unavailable" } })),
          StoreReadError: () =>
            Effect.fail(errors.SESSION_NOT_FOUND({ data: { message: "Session is unavailable" } })),
          StoreWriteError: () =>
            Effect.fail(errors.STORE_WRITE_FAILED({ message: "Association could not be saved" })),
        }),
      );
  }),
  list: orpc.list.effect(function* ({ errors }) {
    return yield* (yield* PullRequestService).list().pipe(catchCurrentRead(errors));
  }),
  detail: orpc.detail.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    if ("ref" in input) {
      const cwd = yield* resolveLinkedCwd(input.ref, input.pullRequest, errors);
      return yield* service.current(cwd, input.pullRequest).pipe(catchCurrentRead(errors));
    }
    return yield* service.detail(input.pullRequest).pipe(catchCurrentRead(errors));
  }),
  stackPreview: orpc.stackPreview.effect(function* ({ input, errors }) {
    const cwd = yield* resolveLinkedCwd(input.ref, input.pullRequest, errors);
    return yield* (yield* PullRequestService)
      .stackPreview(cwd, input.pullRequest, input.action)
      .pipe(
        catchCurrentRead(errors),
        Effect.catchTags({
          PullRequestStaleContext: () =>
            Effect.fail(errors.STALE_CONTEXT({ message: "Stack context changed" })),
          PullRequestUnsupportedAction: () =>
            Effect.fail(
              errors.UNSUPPORTED_ACTION({ message: "Safe Stack actions are unavailable" }),
            ),
          PullRequestHostRejected: () =>
            Effect.fail(errors.HOST_REJECTED({ message: "GitHub rejected the operation" })),
          PullRequestActionOutcomeUnknown: () =>
            Effect.fail(errors.OUTCOME_UNKNOWN({ message: "Stack action outcome is unknown" })),
        }),
      );
  }),
  runStackAction: orpc.runStackAction.effect(function* ({ input, errors }) {
    const cwd = yield* resolveLinkedCwd(input.ref, input.pullRequest, errors);
    const result = yield* (yield* PullRequestService)
      .runStackAction(cwd, input.pullRequest, input.action, input.expected, input.method)
      .pipe(
        catchCurrentRead(errors),
        Effect.catchTags({
          PullRequestStaleContext: () =>
            Effect.fail(errors.STALE_CONTEXT({ message: "Stack context changed; preview again" })),
          PullRequestUnsupportedAction: () =>
            Effect.fail(
              errors.UNSUPPORTED_ACTION({ message: "Safe Stack actions are unavailable" }),
            ),
          PullRequestHostRejected: () =>
            Effect.fail(errors.HOST_REJECTED({ message: "GitHub rejected the operation" })),
          PullRequestActionOutcomeUnknown: () =>
            Effect.fail(errors.OUTCOME_UNKNOWN({ message: "Stack action outcome is unknown" })),
        }),
      );
    yield* (yield* PullRequestCoordinator).dirty(input.ref);
    return result;
  }),
  runAction: orpc.runAction.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const session = "sessionId" in input.ref;
    const target = session
      ? { cwd: yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors) }
      : { pullRequest: input.ref };
    const result = yield* service
      .runAction(target, input.expected, input.action)
      .pipe(catchAction(errors));
    if (session) yield* (yield* PullRequestCoordinator).dirty(input.ref);
    return result;
  }),
});

export type PullRequestRouter = typeof pullRequestRouter;
