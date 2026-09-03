import type {
  PullRequestAction,
  PullRequestActionApplied,
  PullRequestDetail,
  PullRequestDiff,
  PullRequestExpected,
  PullRequestListItem,
  PullRequestRef,
  PullRequestSessionStatus,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Context, Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { PullRequestStaleContext } from "./errors";
import {
  type PullRequestCliActionFailure,
  type PullRequestReadFailure,
  makeGitHubCliAdapter,
} from "./github-cli";
import { foldSessionStatuses, type PullRequestSessionWorkspace } from "./statuses";

const samePullRequest = (left: PullRequestRef, right: PullRequestRef): boolean =>
  left.host === right.host &&
  left.owner === right.owner &&
  left.repository === right.repository &&
  left.number === right.number;

export type PullRequestActionFailure = PullRequestReadFailure | PullRequestCliActionFailure;

export class PullRequestService extends Context.Service<
  PullRequestService,
  {
    readonly current: (
      cwd: string,
      pullRequest?: PullRequestRef,
    ) => Effect.Effect<PullRequestSnapshot | null, PullRequestReadFailure>;
    readonly diff: (cwd: string) => Effect.Effect<PullRequestDiff, PullRequestReadFailure>;
    readonly list: () => Effect.Effect<ReadonlyArray<PullRequestListItem>, PullRequestReadFailure>;
    readonly detail: (
      pullRequest: PullRequestRef,
    ) => Effect.Effect<PullRequestDetail | null, PullRequestReadFailure>;
    readonly runAction: (
      cwd: string,
      expected: PullRequestExpected,
      action: PullRequestAction,
    ) => Effect.Effect<PullRequestActionApplied, PullRequestActionFailure>;
    readonly sessionStatuses: (
      workspaces: ReadonlyArray<PullRequestSessionWorkspace>,
    ) => Effect.Effect<ReadonlyArray<PullRequestSessionStatus>, PullRequestReadFailure>;
  }
>()("PullRequestService") {}

export const PullRequestServiceLayer: Layer.Layer<
  PullRequestService,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  PullRequestService,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cli = makeGitHubCliAdapter(spawner);

    const current = (cwd: string, pullRequest?: PullRequestRef) => cli.current(cwd, pullRequest);
    const diff = (cwd: string) => cli.diff(cwd);
    const list = () => cli.list();
    const detail = (pullRequest: PullRequestRef) => cli.detail(pullRequest);

    const runAction = (
      cwd: string,
      expected: PullRequestExpected,
      action: PullRequestAction,
    ): Effect.Effect<PullRequestActionApplied, PullRequestActionFailure> =>
      Effect.gen(function* () {
        const snapshot = yield* current(cwd);
        if (snapshot === null || !samePullRequest(snapshot.ref, expected.pullRequest)) {
          return yield* new PullRequestStaleContext();
        }
        const expectedHeadSha = "headSha" in expected ? expected.headSha : undefined;
        yield* cli
          .runAction({
            cwd,
            url: snapshot.url,
            action,
            ...(expectedHeadSha === undefined ? undefined : { expectedHeadSha }),
          })
          .pipe(
            Effect.catchTag(
              "PullRequestHostRejected",
              (failure): Effect.Effect<never, PullRequestActionFailure> => {
                if (expectedHeadSha !== undefined && snapshot.head.sha !== expectedHeadSha) {
                  return Effect.fail(new PullRequestStaleContext());
                }
                return Effect.fail(failure);
              },
            ),
          );
        return {
          pullRequest: snapshot.ref,
          action: action.type,
          ...(expectedHeadSha === undefined ? undefined : { appliedHeadSha: expectedHeadSha }),
        };
      });

    const sessionStatuses = (workspaces: ReadonlyArray<PullRequestSessionWorkspace>) =>
      foldSessionStatuses(workspaces, current);

    return { current, diff, list, detail, runAction, sessionStatuses };
  }),
);
