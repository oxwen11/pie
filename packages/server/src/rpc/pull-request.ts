import { pullRequestContract } from "@getpie/contract/pull-request";
import { Effect } from "effect";

import { SessionNotFound } from "../errors";
import { PiAgentSessionService } from "../harness";
import { PullRequestService } from "../pull-request";
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

export const pullRequestRouter = orpc.router({
  current: orpc.current.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const sessions = yield* PiAgentSessionService;
    const cwd = yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors);
    const snapshot = yield* service.current(cwd).pipe(catchCurrentRead(errors));
    if (snapshot !== null) {
      yield* sessions.rememberPullRequestRef(input.ref, snapshot.ref).pipe(
        Effect.catchTags({
          SessionNotFound: () => Effect.void,
          StoreReadError: () => Effect.void,
          StoreWriteError: () => Effect.void,
        }),
      );
    }
    return snapshot;
  }),
  diff: orpc.diff.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    if ("pullRequest" in input) {
      return yield* service.diffFor(input.pullRequest).pipe(catchCurrentRead(errors));
    }
    const cwd = yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors);
    return yield* service.diff(cwd).pipe(catchCurrentRead(errors));
  }),
  statuses: orpc.statuses.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const sessions = yield* PiAgentSessionService;
    const workspaces = yield* Effect.forEach(input.refs, (ref) =>
      Effect.gen(function* () {
        const cwd = yield* resolveWorkspaceCwdOrFail({ ref }, errors);
        const pullRequestRefs = yield* sessions.pullRequestRefsFor(ref).pipe(
          Effect.catchTags({
            SessionNotFound: (error: SessionNotFound) =>
              Effect.fail(
                errors.SESSION_NOT_FOUND({
                  data: { message: `session ${error.sessionId} not found` },
                }),
              ),
            StoreReadError: () =>
              Effect.fail(
                errors.SESSION_NOT_FOUND({ data: { message: "session workspace unavailable" } }),
              ),
          }),
        );
        return { cwd, ref, pullRequestRefs };
      }),
    );
    return yield* service.sessionStatuses(workspaces).pipe(catchCurrentRead(errors));
  }),
  list: orpc.list.effect(function* ({ errors }) {
    const service = yield* PullRequestService;
    return yield* service.list().pipe(catchCurrentRead(errors));
  }),
  detail: orpc.detail.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    return yield* service.detail(input.pullRequest).pipe(catchCurrentRead(errors));
  }),
  runAction: orpc.runAction.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const cwd = yield* resolveWorkspaceCwdOrFail({ ref: input.ref }, errors);
    return yield* service.runAction(cwd, input.expected, input.action).pipe(
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
      }),
    );
  }),
});

export type PullRequestRouter = typeof pullRequestRouter;
