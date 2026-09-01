import type { SessionRef } from "@getpie/contract";
import type { PullRequestLifecycle, PullRequestRef } from "@getpie/contract/pull-request";
import { pullRequestContract } from "@getpie/contract/pull-request";
import { Effect } from "effect";

import { ProjectNotFound, SessionNotFound, StoreReadError } from "../errors";
import { PiAgentSessionService } from "../harness";
import { PullRequestService } from "../pull-request";
import { pickSessionPullRequestLifecycle } from "../pull-request/pick-lifecycle";
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

const pullRequestKey = (ref: PullRequestRef): string =>
  `${ref.host}/${ref.owner}/${ref.repository}#${ref.number}`;

const catchCurrentRead = <
  E extends {
    MISSING_GH: (input: { message: string }) => unknown;
    UNAUTHENTICATED: (input: { message: string }) => unknown;
    RATE_LIMITED: (input: { message: string }) => unknown;
    UNSUPPORTED_CONTEXT: (input: { message: string }) => unknown;
    HOST_UNAVAILABLE: (input: { message: string }) => unknown;
    INVALID_RESPONSE: (input: { message: string }) => unknown;
  },
>(
  errors: E,
) =>
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
  });

export const pullRequestRouter = orpc.router({
  current: orpc.current.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const sessions = yield* PiAgentSessionService;
    const cwd = yield* resolveCwd(input.ref, errors);
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
  statuses: orpc.statuses.effect(function* ({ input, errors }) {
    const service = yield* PullRequestService;
    const sessions = yield* PiAgentSessionService;
    const workspaces = yield* Effect.forEach(input.refs, (ref) =>
      Effect.gen(function* () {
        const cwd = yield* resolveCwd(ref, errors);
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
    const storedLookups: Array<{ key: string; cwd: string; pullRequest: PullRequestRef }> = [];
    const storedKeys = new Set<string>();
    const cwdLookups = new Map<string, Array<SessionRef>>();
    for (const { cwd, ref, pullRequestRefs } of workspaces) {
      if (pullRequestRefs.length === 0) {
        const refs = cwdLookups.get(cwd);
        if (refs === undefined) cwdLookups.set(cwd, [ref]);
        else refs.push(ref);
        continue;
      }
      for (const pullRequest of pullRequestRefs) {
        const key = pullRequestKey(pullRequest);
        if (storedKeys.has(key)) continue;
        storedKeys.add(key);
        storedLookups.push({ key, cwd, pullRequest });
      }
    }

    const storedSnapshots = yield* Effect.forEach(storedLookups, ({ key, cwd, pullRequest }) =>
      service.current(cwd, pullRequest).pipe(
        catchCurrentRead(errors),
        Effect.map((snapshot) => [key, snapshot] as const),
      ),
    );
    const snapshotsByKey = new Map(storedSnapshots);
    const cwdSnapshots = yield* Effect.forEach(cwdLookups, ([cwd]) =>
      service.current(cwd).pipe(
        catchCurrentRead(errors),
        Effect.map((snapshot) => [cwd, snapshot] as const),
      ),
    );
    const snapshotsByCwd = new Map(cwdSnapshots);

    const statuses: Array<{ ref: SessionRef; lifecycle: PullRequestLifecycle }> = [];
    for (const { cwd, ref, pullRequestRefs } of workspaces) {
      if (pullRequestRefs.length === 0) {
        const snapshot = snapshotsByCwd.get(cwd);
        if (snapshot) statuses.push({ ref, lifecycle: snapshot.lifecycle });
        continue;
      }
      const lifecycle = pickSessionPullRequestLifecycle(
        pullRequestRefs.map(
          (pullRequest) => snapshotsByKey.get(pullRequestKey(pullRequest)) ?? null,
        ),
      );
      if (lifecycle !== undefined) statuses.push({ ref, lifecycle });
    }
    return statuses;
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
