import type { SessionRef } from "@getpie/contract";
import type {
  PullRequestRef,
  PullRequestSessionStatus,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Effect } from "effect";

import { pickSessionPullRequest } from "./pick-lifecycle";

export type PullRequestSessionWorkspace = {
  readonly ref: SessionRef;
  readonly cwd: string;
  readonly pullRequestRefs: ReadonlyArray<PullRequestRef>;
};

const pullRequestKey = (ref: PullRequestRef): string =>
  `${ref.host}/${ref.owner}/${ref.repository}#${ref.number}`;

export const foldSessionStatuses = <E>(
  workspaces: ReadonlyArray<PullRequestSessionWorkspace>,
  lookup: (
    cwd: string,
    pullRequest?: PullRequestRef,
  ) => Effect.Effect<PullRequestSnapshot | null, E>,
): Effect.Effect<ReadonlyArray<PullRequestSessionStatus>, E> =>
  Effect.gen(function* () {
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
      lookup(cwd, pullRequest).pipe(Effect.map((snapshot) => [key, snapshot] as const)),
    );
    const snapshotsByKey = new Map(storedSnapshots);
    const cwdSnapshots = yield* Effect.forEach(cwdLookups, ([cwd]) =>
      lookup(cwd).pipe(Effect.map((snapshot) => [cwd, snapshot] as const)),
    );
    const snapshotsByCwd = new Map(cwdSnapshots);

    const statuses: Array<PullRequestSessionStatus> = [];
    for (const { cwd, ref, pullRequestRefs } of workspaces) {
      if (pullRequestRefs.length === 0) {
        const snapshot = snapshotsByCwd.get(cwd);
        if (snapshot) statuses.push({ ref, lifecycle: snapshot.lifecycle, url: snapshot.url });
        continue;
      }
      const snapshot = pickSessionPullRequest(
        pullRequestRefs.map(
          (pullRequest) => snapshotsByKey.get(pullRequestKey(pullRequest)) ?? null,
        ),
      );
      if (snapshot !== undefined) {
        statuses.push({ ref, lifecycle: snapshot.lifecycle, url: snapshot.url });
      }
    }
    return statuses;
  });
