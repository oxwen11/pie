import type { SessionRef } from "@getpie/contract";
import {
  pullRequestKey,
  type PullRequestDemandInput,
  type PullRequestDemandOutput,
  type PullRequestRef,
  type PullRequestSessionStatus,
  type PullRequestStack,
  type PullRequestSummary,
  type SessionPullRequestLink,
} from "@getpie/contract/pull-request";
import { Clock, Context, Data, Effect, Fiber, Queue, Scope, Semaphore, Stream } from "effect";

import type { EventBusShape } from "../events/event-bus";
import type { PiAgentSessionServiceShape } from "../harness/session-service";
import { PullRequestHostUnavailable } from "./errors";
import type { PullRequestReadFailure } from "./github-cli";

export class InvalidPullRequestLease extends Data.TaggedError("InvalidPullRequestLease") {}
class PullRequestReadCancelled extends Data.TaggedError("PullRequestReadCancelled") {}

export type PullRequestCoordinatorShape = {
  readonly statuses: (
    refs: ReadonlyArray<SessionRef>,
  ) => Effect.Effect<ReadonlyArray<PullRequestSessionStatus>>;
  readonly demand: (
    input: PullRequestDemandInput,
  ) => Effect.Effect<PullRequestDemandOutput, InvalidPullRequestLease>;
  readonly refresh: (ref: SessionRef) => Effect.Effect<PullRequestSessionStatus>;
  readonly dirty: (ref: SessionRef) => Effect.Effect<void>;
};
export class PullRequestCoordinator extends Context.Service<
  PullRequestCoordinator,
  PullRequestCoordinatorShape
>()("PullRequestCoordinator") {}

export type PullRequestSummaryReader = {
  readonly summary: (
    cwd: string,
    ref: PullRequestRef,
  ) => Effect.Effect<PullRequestSummary | null, PullRequestReadFailure>;
  readonly discover: (
    cwd: string,
    branch: string,
  ) => Effect.Effect<PullRequestSummary | null, PullRequestReadFailure>;
  readonly stack: (
    cwd: string,
    ref: PullRequestRef,
  ) => Effect.Effect<PullRequestStack | null, PullRequestReadFailure>;
};
const sessionKey = (ref: SessionRef) => `${ref.projectId}\0${ref.sessionId}`;
const MINUTE = 60_000;
const LEASE_MS = 90_000;
const summaryTtl = (summary: PullRequestSummary | null) =>
  summary?.lifecycle.type === "merged"
    ? Infinity
    : summary?.lifecycle.type === "closed"
      ? 15 * MINUTE
      : MINUTE;
const safeError = (failure: { readonly _tag: string }): string => {
  switch (failure._tag) {
    case "PullRequestMissingGh":
      return "GitHub CLI is not installed";
    case "PullRequestUnauthenticated":
      return "GitHub CLI is not authenticated";
    case "PullRequestRateLimited":
      return "GitHub rate limit reached";
    case "PullRequestUnsupportedContext":
      return "Repository context is unavailable";
    case "PullRequestInvalidResponse":
      return "GitHub returned an invalid response";
    default:
      return "Pull request status is unavailable";
  }
};
type ReadEntry<A> = {
  value?: A;
  checkedAt?: number;
  dirty: boolean;
  failures: number;
  retryAt: number;
  error?: PullRequestReadFailure;
  flight?: Fiber.Fiber<A, PullRequestReadFailure | PullRequestReadCancelled>;
};
type SessionState = {
  ref: SessionRef;
  generation: number;
  completed: number;
  nextAt: number;
  state: PullRequestSessionStatus["state"];
  error?: string;
  observedGeneration?: number;
  discoveryKey?: string;
  flight?: Fiber.Fiber<void>;
};

/** One server-owned scheduler. A local event or cached read never creates demand. */
export const makePullRequestCoordinator = (deps: {
  readonly sessions: PiAgentSessionServiceShape;
  readonly github: PullRequestSummaryReader;
  readonly bus: EventBusShape;
  readonly newLeaseId: Effect.Effect<string>;
  readonly projectPathFor: (projectId: string) => Effect.Effect<string, unknown>;
}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const wake = yield* Queue.dropping<void>(1);
    const leases = new Map<
      string,
      { version: number; expiresAt: number; refs: ReadonlyArray<SessionRef> }
    >();
    const states = new Map<string, SessionState>();
    const summaries = new Map<string, ReadEntry<PullRequestSummary | null>>();
    const stacks = new Map<string, ReadEntry<PullRequestStack | null>>();
    const discoveries = new Map<string, ReadEntry<PullRequestSummary | null>>();
    const globalLimit = Semaphore.makeUnsafe(4);
    const hostLimits = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
    const cooldowns = new Map<string, number>();
    const stateFor = (ref: SessionRef): SessionState => {
      const key = sessionKey(ref);
      let state = states.get(key);
      if (!state) {
        state = { ref, generation: 0, completed: -1, nextAt: 0, state: "idle" };
        states.set(key, state);
      }
      return state;
    };
    const demanded = (ref: SessionRef, now: number) =>
      [...leases.values()].some(
        (lease) =>
          lease.expiresAt > now &&
          lease.refs.some((candidate) => sessionKey(candidate) === sessionKey(ref)),
      );
    const hasDemand = (ref: SessionRef, explicit: boolean) =>
      explicit
        ? Effect.succeed(true)
        : Clock.currentTimeMillis.pipe(Effect.map((now) => demanded(ref, now)));
    const publishState = (
      state: SessionState,
      next: PullRequestSessionStatus["state"],
      error?: string,
    ) =>
      Effect.gen(function* () {
        if (state.state === next && state.error === error) return;
        state.state = next;
        if (error === undefined) delete state.error;
        else state.error = error;
        yield* deps.bus.publish({ ref: state.ref, type: "session.pull-requests.updated" });
      });
    const read = <A>(
      map: Map<string, ReadEntry<A>>,
      key: string,
      host: string,
      effect: Effect.Effect<A, PullRequestReadFailure>,
      ttl: (value: A) => number,
      permitted: Effect.Effect<boolean>,
    ): Effect.Effect<A, PullRequestReadFailure | PullRequestReadCancelled> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        let entry = map.get(key);
        if (!entry) {
          entry = { dirty: true, failures: 0, retryAt: 0 };
          map.set(key, entry);
        }
        if (entry.flight) return yield* Fiber.join(entry.flight);
        if (entry.error && entry.retryAt > now) return yield* entry.error;
        if (
          !entry.dirty &&
          entry.checkedAt !== undefined &&
          now < entry.checkedAt + ttl(entry.value as A)
        )
          return entry.value as A;
        if ((cooldowns.get("*") ?? 0) > now || (cooldowns.get(host) ?? 0) > now)
          return yield* new PullRequestHostUnavailable();
        const current = entry;
        const limit = hostLimits.get(host) ?? Semaphore.makeUnsafe(2);
        hostLimits.set(host, limit);
        const fetch = globalLimit.withPermit(
          limit.withPermit(
            Effect.gen(function* () {
              if (!(yield* permitted)) return yield* new PullRequestReadCancelled();
              return yield* effect.pipe(
                Effect.timeoutOrElse({
                  duration: "20 seconds",
                  orElse: () => Effect.fail(new PullRequestHostUnavailable()),
                }),
              );
            }),
          ),
        );
        // Clear at start. A dirty event during the read sets it again and survives completion.
        current.dirty = false;
        current.flight = yield* fetch.pipe(
          Effect.tap((value) =>
            Clock.currentTimeMillis.pipe(
              Effect.map((finished) => {
                current.value = value;
                current.checkedAt = finished;
                current.failures = 0;
                current.retryAt = 0;
                delete current.error;
              }),
            ),
          ),
          Effect.tapError((failure) =>
            Clock.currentTimeMillis.pipe(
              Effect.map((finished) => {
                if (failure._tag === "PullRequestReadCancelled") {
                  current.dirty = true;
                  return;
                }
                current.error = failure;
                current.failures += 1;
                current.dirty = true;
                current.retryAt =
                  finished + Math.min(15 * MINUTE, MINUTE * 2 ** (current.failures - 1));
                if (failure._tag === "PullRequestMissingGh") cooldowns.set("*", current.retryAt);
                if (
                  failure._tag === "PullRequestUnauthenticated" ||
                  failure._tag === "PullRequestRateLimited"
                )
                  cooldowns.set(host, current.retryAt);
              }),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              delete current.flight;
            }),
          ),
          Effect.forkIn(scope),
        );
        return yield* Fiber.join(current.flight);
      });
    const statuses: PullRequestCoordinatorShape["statuses"] = (refs) =>
      Effect.forEach(refs, (ref) =>
        deps.sessions.pullRequestsFor(ref).pipe(
          Effect.map((links): PullRequestSessionStatus => {
            const state = states.get(sessionKey(ref));
            return {
              ref,
              links,
              state: state?.state ?? (links.some((link) => !link.excluded) ? "idle" : "unbound"),
              ...(state?.error ? { error: state.error } : undefined),
            };
          }),
          Effect.catch(() =>
            Effect.succeed<PullRequestSessionStatus>({
              ref,
              links: [],
              state: "error",
              error: "Session is unavailable",
            }),
          ),
        ),
      );
    const sync = (state: SessionState, explicit: boolean) =>
      Effect.gen(function* () {
        const permitted = hasDemand(state.ref, explicit);
        if (!(yield* permitted)) return;
        const generation = state.generation;
        const expected = yield* deps.sessions.pullRequestContextFor(state.ref);
        // Explicit identities use the Project directory even if an old worktree disappeared.
        const cwd = yield* deps.projectPathFor(state.ref.projectId);
        const nowAtStart = yield* Clock.currentTimeMillis;
        const seed = <A>(
          map: Map<string, ReadEntry<A>>,
          key: string,
          value: A,
          checkedAt: string | null,
        ) => {
          if (map.has(key) || checkedAt === null) return;
          const timestamp = Date.parse(checkedAt);
          if (!Number.isFinite(timestamp)) return;
          map.set(key, {
            value,
            checkedAt: Math.min(timestamp, nowAtStart),
            dirty: state.generation > 0,
            failures: 0,
            retryAt: 0,
          });
        };
        const updates: SessionPullRequestLink[] = [];
        const failures: string[] = [];
        yield* publishState(state, "pending");
        const attempt = <A>(
          effect: Effect.Effect<A, PullRequestReadFailure | PullRequestReadCancelled>,
        ) =>
          effect.pipe(
            Effect.map((value) => ({ value })),
            Effect.catch((failure) => {
              if (failure._tag !== "PullRequestReadCancelled") failures.push(safeError(failure));
              return Effect.succeed(null);
            }),
          );
        const candidates = expected.links.filter((link) => !link.excluded);
        if (expected.branch && (yield* permitted)) {
          const discoveryCwd = expected.cwd ?? cwd;
          state.discoveryKey = `${discoveryCwd}\0${expected.branch}`;
          const discovered = yield* attempt(
            read(
              discoveries,
              state.discoveryKey,
              cwd,
              deps.github.discover(discoveryCwd, expected.branch),
              () => 5 * MINUTE,
              permitted,
            ),
          );
          if (
            discovered?.value &&
            !expected.links.some(
              (link) => pullRequestKey(link.ref) === pullRequestKey(discovered.value!.ref),
            )
          ) {
            candidates.push({
              ref: discovered.value.ref,
              source: "branch",
              linkedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              excluded: false,
              snapshot: discovered.value,
              stack: null,
              stackCheckedAt: null,
            });
          }
        }
        for (const link of candidates) {
          if (!(yield* permitted)) break;
          const key = pullRequestKey(link.ref);
          if (link.snapshot) seed(summaries, key, link.snapshot, link.snapshot.checkedAt);
          seed(stacks, key, link.stack, link.stackCheckedAt);
          // Known native members share one topology read, including after restart.
          const stackEntry = stacks.get(key);
          if (stackEntry && link.stack) {
            for (const member of link.stack.layers) {
              const alias = pullRequestKey(member.ref);
              if (!stacks.has(alias)) stacks.set(alias, stackEntry);
            }
          }
          let updated = link;
          const summary = yield* attempt(
            read(
              summaries,
              key,
              link.ref.host,
              deps.github.summary(cwd, link.ref),
              summaryTtl,
              permitted,
            ),
          );
          if (summary?.value) updated = { ...updated, snapshot: summary.value };
          if (yield* permitted) {
            const topology = yield* attempt(
              read(
                stacks,
                key,
                link.ref.host,
                deps.github.stack(cwd, link.ref),
                () => 5 * MINUTE,
                permitted,
              ),
            );
            if (topology) {
              const entry = stacks.get(key);
              if (entry) {
                const members = new Set(
                  topology.value?.layers.map((member) => pullRequestKey(member.ref)),
                );
                for (const [alias, cached] of stacks) {
                  if (cached === entry && alias !== key && !members.has(alias))
                    stacks.delete(alias);
                }
                for (const alias of members) {
                  if (!stacks.get(alias)?.flight) stacks.set(alias, entry);
                }
              }
              updated = {
                ...updated,
                stack: topology.value,
                stackCheckedAt: new Date(
                  stacks.get(key)?.checkedAt ?? (yield* Clock.currentTimeMillis),
                ).toISOString(),
              };
              if (yield* permitted)
                for (const member of topology.value?.layers ?? []) {
                  if (
                    expected.links.some(
                      (existing) => pullRequestKey(existing.ref) === pullRequestKey(member.ref),
                    ) ||
                    candidates.some(
                      (candidate) => pullRequestKey(candidate.ref) === pullRequestKey(member.ref),
                    ) ||
                    updates.some(
                      (candidate) => pullRequestKey(candidate.ref) === pullRequestKey(member.ref),
                    )
                  )
                    continue;
                  updates.push({
                    ref: member.ref,
                    source: "stack",
                    linkedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                    excluded: false,
                    snapshot: null,
                    stack: topology.value,
                    stackCheckedAt: updated.stackCheckedAt,
                  });
                }
            }
          }
          updates.push(updated);
        }
        const saved = yield* deps.sessions.mergePullRequests(state.ref, expected, updates);
        if (saved) state.completed = generation;
        const now = yield* Clock.currentTimeMillis;
        const due = [now + 5 * MINUTE];
        for (const link of candidates) {
          const key = pullRequestKey(link.ref);
          const summary = summaries.get(key);
          const stack = stacks.get(key);
          if (summary)
            due.push(
              summary.error
                ? summary.retryAt
                : summary.dirty
                  ? now + 1_000
                  : (summary.checkedAt ?? now) + summaryTtl(summary.value ?? null),
            );
          if (stack)
            due.push(
              stack.error
                ? stack.retryAt
                : stack.dirty
                  ? now + 1_000
                  : (stack.checkedAt ?? now) + 5 * MINUTE,
            );
        }
        state.nextAt =
          !saved ||
          state.generation !== generation ||
          updates.some(
            (link) =>
              link.snapshot === null &&
              !expected.links.some((old) => pullRequestKey(old.ref) === pullRequestKey(link.ref)),
          )
            ? now + 1_000
            : Math.max(now + 1_000, Math.min(...due));
        yield* publishState(
          state,
          failures.length > 0
            ? "error"
            : candidates.length > 0 || updates.length > 0
              ? "ready"
              : "unbound",
          failures[0],
        );
      }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            state.nextAt = (yield* Clock.currentTimeMillis) + MINUTE;
            yield* publishState(state, "error", "Session pull request data is unavailable");
          }),
        ),
      );
    const start = (state: SessionState, explicit: boolean): Effect.Effect<Fiber.Fiber<void>> =>
      Effect.gen(function* () {
        if (state.flight) return state.flight;
        state.flight = yield* sync(state, explicit).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              delete state.flight;
            }),
          ),
          Effect.forkIn(scope),
        );
        return state.flight;
      });
    const dirty: PullRequestCoordinatorShape["dirty"] = (ref) =>
      Effect.gen(function* () {
        const state = stateFor(ref);
        state.generation += 1;
        state.nextAt = 0;
        // Dirty shared remote entries only for this Session's known identities.
        const links = yield* deps.sessions
          .pullRequestsFor(ref)
          .pipe(Effect.catch(() => Effect.succeed([])));
        if (state.discoveryKey) {
          const discovery = discoveries.get(state.discoveryKey);
          if (discovery) discovery.dirty = true;
        }
        for (const link of links) {
          const key = pullRequestKey(link.ref);
          const summary = summaries.get(key);
          if (summary) summary.dirty = true;
          const stack = stacks.get(key);
          if (stack) stack.dirty = true;
        }
        yield* Queue.offer(wake, undefined);
      });
    const demand: PullRequestCoordinatorShape["demand"] = (input) =>
      Effect.gen(function* () {
        if (input.refs.length > 100 || !Number.isSafeInteger(input.version) || input.version < 0)
          return yield* new InvalidPullRequestLease();
        // Validate each ref before accepting the capability. No remote lookup or runtime opening.
        for (const ref of input.refs)
          yield* deps.sessions
            .pullRequestsFor(ref)
            .pipe(Effect.mapError(() => new InvalidPullRequestLease()));
        const now = yield* Clock.currentTimeMillis;
        const prior = input.leaseId === undefined ? undefined : leases.get(input.leaseId);
        if (
          input.leaseId !== undefined &&
          (!prior || prior.expiresAt <= now || input.version <= prior.version)
        )
          return yield* new InvalidPullRequestLease();
        const leaseId = input.leaseId ?? (yield* deps.newLeaseId);
        const expiresAt = input.refs.length > 0 ? now + LEASE_MS : now;
        if (input.refs.length > 0)
          leases.set(leaseId, { version: input.version, expiresAt, refs: input.refs });
        else leases.delete(leaseId);
        yield* Queue.offer(wake, undefined);
        return { leaseId, expiresAt: new Date(expiresAt).toISOString() };
      });
    const refresh: PullRequestCoordinatorShape["refresh"] = (ref) =>
      Effect.gen(function* () {
        yield* dirty(ref);
        const state = stateFor(ref);
        if (state.flight) yield* Fiber.join(state.flight);
        yield* Fiber.join(yield* start(state, true));
        const result = yield* statuses([ref]);
        return result[0]!;
      });
    const events = yield* deps.bus.subscribe({ kind: "global" });
    yield* events.pipe(
      Stream.runForEach((message) => {
        if (message.type !== "event") return Effect.void;
        const event = message.event;
        if (event.type === "session.turn.ended") return dirty(event.ref);
        if (event.type === "session.deleted")
          return Effect.sync(() => {
            states.delete(sessionKey(event.ref));
            for (const lease of leases.values())
              lease.refs = lease.refs.filter((ref) => sessionKey(ref) !== sessionKey(event.ref));
          });
        // PR notifications only invalidate local scheduling, never authorize remote work.
        if (event.type === "session.pull-requests.updated")
          return deps.sessions.pullRequestContextFor(event.ref).pipe(
            Effect.flatMap((context) => {
              const state = stateFor(event.ref);
              if (context.generation !== state.observedGeneration) {
                state.observedGeneration = context.generation;
                state.nextAt = 0;
              }
              return Queue.offer(wake, undefined).pipe(Effect.asVoid);
            }),
            Effect.catch(() => Effect.void),
          );
        return Effect.void;
      }),
      Effect.forkIn(scope),
    );
    yield* Effect.gen(function* () {
      while (true) {
        const now = yield* Clock.currentTimeMillis;
        for (const [id, lease] of leases) if (lease.expiresAt <= now) leases.delete(id);
        const refs = new Map(
          [...leases.values()].flatMap((lease) =>
            lease.refs.map((ref) => [sessionKey(ref), ref] as const),
          ),
        );
        for (const ref of refs.values()) {
          const state = stateFor(ref);
          if (!state.flight && state.nextAt <= now) yield* start(state, false);
        }
        if (refs.size === 0) yield* Queue.take(wake);
        else yield* Effect.sleep("1 second");
      }
    }).pipe(Effect.forkIn(scope));
    return { statuses, demand, refresh, dirty } satisfies PullRequestCoordinatorShape;
  });
