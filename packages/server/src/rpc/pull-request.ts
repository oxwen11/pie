import type { SessionRef } from "@getpie/contract";
import { pullRequestContract } from "@getpie/contract/pull-request";
import { Effect } from "effect";

import { ProjectNotFound, SessionNotFound, StoreReadError } from "../errors";
import { PullRequestService } from "../pull-request";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { resolveWorkspaceCwd } from "./resolve-workspace";

const orpc = implement(pullRequestContract).$context<RpcContext>();

const resolveCwd = <
  E extends { SESSION_NOT_FOUND: (input: { data: { message: string } }) => unknown },
>(
  ref: SessionRef,
  errors: E,
) =>
  resolveWorkspaceCwd({ ref }).pipe(
    Effect.catchTags({
      SessionNotFound: (error: SessionNotFound) =>
        Effect.fail(
          errors.SESSION_NOT_FOUND({ data: { message: `session ${error.sessionId} not found` } }),
        ),
      ProjectNotFound: (error: ProjectNotFound) =>
        Effect.fail(
          errors.SESSION_NOT_FOUND({ data: { message: `project ${error.projectId} not found` } }),
        ),
      StoreReadError: (_error: StoreReadError) =>
        Effect.fail(
          errors.SESSION_NOT_FOUND({ data: { message: "session workspace unavailable" } }),
        ),
    }),
  );

export const pullRequestRouter = orpc.router({
  current: orpc.current.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const cwd = yield* resolveCwd(input.ref, errors);
    return yield* service.current(cwd).pipe(
      Effect.catchTags({
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
      }),
    );
  }),
  statuses: orpc.statuses.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const workspaces = yield* Effect.forEach(input.refs, (ref) =>
      resolveCwd(ref, errors).pipe(Effect.map((cwd) => ({ cwd, ref }))),
    );
    const refsByCwd = new Map<string, Array<SessionRef>>();
    for (const { cwd, ref } of workspaces) {
      const refs = refsByCwd.get(cwd);
      if (refs === undefined) refsByCwd.set(cwd, [ref]);
      else refs.push(ref);
    }

    const statusGroups = yield* Effect.forEach(refsByCwd, ([cwd, refs]) =>
      service.current(cwd).pipe(
        Effect.map((snapshot) =>
          snapshot === null ? [] : refs.map((ref) => ({ ref, lifecycle: snapshot.lifecycle })),
        ),
        Effect.catchTags({
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
            Effect.fail(
              errors.INVALID_RESPONSE({ message: "GitHub returned an invalid response" }),
            ),
        }),
      ),
    );
    return statusGroups.flat();
  }),
  runAction: orpc.runAction.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const cwd = yield* resolveCwd(input.ref, errors);
    return yield* service.runAction(cwd, input.expected, input.action).pipe(
      Effect.catchTags({
        PullRequestStaleContext: () =>
          Effect.fail(errors.STALE_CONTEXT({ message: "Pull request context changed" })),
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
        PullRequestHostUnavailable: () =>
          Effect.fail(errors.HOST_UNAVAILABLE({ message: "GitHub is unavailable" })),
        PullRequestInvalidResponse: () =>
          Effect.fail(errors.INVALID_RESPONSE({ message: "GitHub returned an invalid response" })),
      }),
    );
  }),
});

export type PullRequestRouter = typeof pullRequestRouter;
