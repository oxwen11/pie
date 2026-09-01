import type { PullRequestLifecycle } from "@getpie/contract/pull-request";

const sameLifecycle = (
  left: PullRequestLifecycle | undefined,
  right: PullRequestLifecycle,
): boolean => {
  if (left === undefined || left.type !== right.type) return false;
  return left.type !== "open" || right.type !== "open" || left.draft === right.draft;
};

/** Keep last-seen icons. Incoming misses and failed reads do not clear. */
export function rememberPullRequestLifecycles(
  previous: ReadonlyMap<string, PullRequestLifecycle>,
  incoming: ReadonlyMap<string, PullRequestLifecycle> | undefined,
): ReadonlyMap<string, PullRequestLifecycle> {
  if (incoming === undefined) return previous;
  let next: Map<string, PullRequestLifecycle> | undefined;
  for (const [sessionId, lifecycle] of incoming) {
    if (sameLifecycle(previous.get(sessionId), lifecycle)) continue;
    next ??= new Map(previous);
    next.set(sessionId, lifecycle);
  }
  return next ?? previous;
}

/** Fold one session's live current snapshot into the remembered list. */
export function rememberPullRequestLifecycle(
  previous: ReadonlyMap<string, PullRequestLifecycle>,
  sessionId: string | undefined,
  lifecycle: PullRequestLifecycle | null | undefined,
): ReadonlyMap<string, PullRequestLifecycle> {
  if (sessionId === undefined || lifecycle == null) return previous;
  if (sameLifecycle(previous.get(sessionId), lifecycle)) return previous;
  return new Map([...previous, [sessionId, lifecycle]]);
}
