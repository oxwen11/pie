import type {
  PullRequestAction,
  PullRequestActionApplied,
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
export type PullRequestActionTarget =
  | { readonly cwd: string }
  | { readonly pullRequest: PullRequestRef };

export class PullRequestService extends Context.Service<
  PullRequestService,
  {
    readonly current: (
      cwd: string,
      pullRequest?: PullRequestRef,
    ) => Effect.Effect<PullRequestSnapshot | null, PullRequestReadFailure>;
    readonly diff: (cwd: string) => Effect.Effect<PullRequestDiff, PullRequestReadFailure>;
    readonly diffFor: (
      pullRequest: PullRequestRef,
    ) => Effect.Effect<PullRequestDiff, PullRequestReadFailure>;
    readonly list: () => Effect.Effect<ReadonlyArray<PullRequestListItem>, PullRequestReadFailure>;
    readonly detail: (
      pullRequest: PullRequestRef,
    ) => Effect.Effect<PullRequestSnapshot | null, PullRequestReadFailure>;
    readonly runAction: (
      target: PullRequestActionTarget,
      expected: PullRequestExpected,
      action: PullRequestAction,
    ) => Effect.Effect<PullRequestActionApplied, PullRequestActionFailure>;
    readonly sessionStatuses: (
      workspaces: ReadonlyArray<PullRequestSessionWorkspace>,
    ) => Effect.Effect<ReadonlyArray<PullRequestSessionStatus>, PullRequestReadFailure>;
  }
>()("pie/PullRequestService") {}

export const PullRequestServiceLayer: Layer.Layer<
  PullRequestService,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  PullRequestService,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cli = makeGitHubCliAdapter(spawner);

    const current = Effect.fn("PullRequestService.current")(function* (
      cwd: string,
      pullRequest?: PullRequestRef,
    ) {
      return yield* cli.current(cwd, pullRequest);
    });
    const diff = Effect.fn("PullRequestService.diff")(function* (cwd: string) {
      return yield* cli.diff(cwd);
    });
    const diffFor = Effect.fn("PullRequestService.diffFor")(function* (
      pullRequest: PullRequestRef,
    ) {
      return yield* cli.diffFor(pullRequest);
    });
    const list = Effect.fn("PullRequestService.list")(function* () {
      return yield* cli.list();
    });
    const detail = Effect.fn("PullRequestService.detail")(function* (pullRequest: PullRequestRef) {
      return yield* cli.detail(pullRequest);
    });

    const runAction = Effect.fn("PullRequestService.runAction")(function* (
      target: PullRequestActionTarget,
      expected: PullRequestExpected,
      action: PullRequestAction,
    ) {
      const snapshot = yield* "cwd" in target ? current(target.cwd) : detail(target.pullRequest);
      if (snapshot === null || !samePullRequest(snapshot.ref, expected.pullRequest)) {
        return yield* new PullRequestStaleContext();
      }
      const expectedHeadSha = "headSha" in expected ? expected.headSha : undefined;
      yield* cli
        .runAction({
          ...("cwd" in target ? { cwd: target.cwd } : undefined),
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

    const sessionStatuses = Effect.fn("PullRequestService.sessionStatuses")(function* (
      workspaces: ReadonlyArray<PullRequestSessionWorkspace>,
    ) {
      return yield* foldSessionStatuses(workspaces, current);
    });

    return { current, diff, diffFor, list, detail, runAction, sessionStatuses };
  }),
);
