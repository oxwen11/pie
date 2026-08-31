# GitHub Pull Request Integration Design

## Status

Proposed.

## Summary

Add a session-scoped GitHub pull request integration to pie. The first version resolves the pull request associated with the current session workspace, displays its lifecycle and checks, and supports merge and auto-merge actions through the user's authenticated GitHub CLI.

The design is informed by `pingdotgg/t3code`, but deliberately keeps a smaller first-version shape:

- one current pull request per session workspace;
- GitHub only;
- one authoritative client query for freshness;
- one primary `gh pr view` read path;
- host-atomic stale-head protection for merge and enable-auto-merge actions;
- no provider registry, webhook system, or server snapshot cache.

For V1, the private GitHub CLI adapter launches finite `gh` commands through pie's existing Effect `ChildProcessSpawner` service. It owns a small scoped execution helper with fixed timeout and output bounds. A reusable command executor and process-wide scheduling policy are deferred until a second real consumer justifies them.

## Goals

1. Resolve the GitHub pull request associated with a session's actual workspace, including a pie-created worktree.
2. Display lifecycle, draft state, mergeability, checks, review decision, and auto-merge state.
3. Display a compact pull request status in the session header.
4. Provide a session-bound pull request content panel with check details.
5. Support merge, squash, rebase, enable auto-merge, and disable auto-merge.
6. Use GitHub's host-side head-commit precondition for race-safe merge actions.
7. Treat GitHub as the authority for permissions, required checks, reviews, rulesets, branch protection, and merge queues.
8. Keep mutation acknowledgement separate from subsequent query refresh.
9. Preserve the existing RPC workspace-resolution and frontend feature-composition seams.

## Non-goals

The first version does not include:

- a project-wide or cross-project pull request list;
- pull request search or filters;
- pull request creation;
- comments, review threads, or inline review;
- close, reopen, draft, ready, or update-branch actions;
- GitLab, Azure DevOps, or Bitbucket;
- a source-control provider registry;
- GitHub webhooks;
- persistence of pull request state in Project or Session metadata;
- a server-side pull request snapshot cache;
- local reproduction of GitHub's effective merge policy;
- a complete custom Git remote and fork resolution subsystem;
- a reusable command executor, process-wide command queue, or migration of existing `simple-git` paths.

## Core decisions

### The wire uses `SessionRef`; the server module uses cwd

The client addresses operations with a complete `SessionRef`. The RPC adapter resolves it through the existing canonical helper:

```text
SessionRef
  → resolveWorkspaceCwd({ ref })
  → PiAgentSessionService.workspaceFor(ref)
  → workspace cwd
```

The internal `PullRequestService` receives the resolved cwd. It does not depend on session persistence, Project lookup, or browser-supplied paths.

### GitHub CLI is the host adapter

The first implementation reuses the user's local `gh` authentication. pie does not accept or persist a GitHub token.

`GitHubCliAdapter` owns command construction, scoped process execution, bounded output collection, JSON decoding, and conservative GitHub failure classification. It uses the existing Effect `ChildProcessSpawner` service from the server Platform Layer and never returns a raw process handle.

The private execution helper is intentionally narrow: direct executable plus argv, workspace cwd, a fixed 30-second timeout, concurrent stdout/stderr draining, and a fixed 4 MiB combined output ceiling. Scope closure terminates the child. V1 introduces no reusable command service, shared semaphore, priority lane, or process-wide capacity claim.

### `gh pr view` resolves the current branch's PR

Without an argument, `gh pr view` resolves the pull request belonging to the current branch. The first version uses that behavior in the session workspace instead of prebuilding a custom remote-selection algorithm.

Representative fork, multiple-remote, detached-HEAD, and GitHub Enterprise fixtures must verify this assumption. Add explicit local repository resolution only for a demonstrated failing case.

### TanStack Query owns snapshot freshness

The first version has no server snapshot cache and no `pullRequest.refresh` RPC. Header and panel consumers share the exact same generated query key. Manual refresh is a query refetch. Mutation success invalidates that query.

### Mutations acknowledge the write; refresh is separate

A successful irreversible GitHub write cannot become a failed mutation because a follow-up read timed out or observed eventual consistency. `runAction` returns an acknowledgement after GitHub accepts the action. The client then invalidates and refetches `current`.

### GitHub enforces the head revision atomically

A local preflight check is not sufficient because another client may push between the check and the merge. Merge and enable-auto-merge use GitHub CLI's host-side head precondition:

```text
--match-head-commit <expected-sha>
```

The implementation must probe or otherwise require a `gh` version that supports this capability. If unavailable, the action is unsupported rather than silently falling back to a racy local-only check.

## Architecture

```text
apps/app
  ├─ session header status
  └─ pull request content panel
        │
        │ typed oRPC using SessionRef
        ▼
packages/server/src/rpc/pull-request.ts
  ├─ resolveWorkspaceCwd({ ref })
  └─ map domain failures to named RPC errors
        │ resolved cwd
        ▼
PullRequestService
  ├─ current(cwd)
  └─ runAction(cwd, expected, action)
        │
        ▼
private GitHubCliAdapter
  ├─ scoped Effect ChildProcessSpawner execution
  ├─ gh pr view
  └─ gh pr merge
```

## Wire interface

The first version exposes two operations:

```ts
interface PullRequestRpc {
  current(input: { ref: SessionRef }): PullRequestSnapshot | null;

  runAction(input: PullRequestActionInput): PullRequestActionApplied;
}
```

There is no refresh procedure. Refreshing means invoking the current query again.

## Pull request identity

```ts
interface PullRequestRef {
  host: string;
  owner: string;
  repository: string;
  number: number;
}
```

The adapter derives this stable identity from the PR URL returned by GitHub. Mutation commands target the stable URL or explicit host/repository/number rather than asking `gh` to infer a different PR at write time.

## Snapshot model

Use discriminated states to prevent impossible combinations and reduce frontend condition chains.

```ts
type PullRequestLifecycle =
  { type: "open"; draft: boolean } | { type: "closed" } | { type: "merged" };

type PullRequestChecksSummary = "passing" | "pending" | "failing" | "none";

type PullRequestReviewDecision = "approved" | "changes-requested" | "review-required" | "none";

type PullRequestMergeMethod = "merge" | "squash" | "rebase";

type PullRequestOfferedAction =
  | {
      type: "merge";
      methods: ReadonlyArray<PullRequestMergeMethod>;
    }
  | {
      type: "enable-auto-merge";
      methods: ReadonlyArray<PullRequestMergeMethod>;
    }
  | {
      type: "disable-auto-merge";
    };

interface PullRequestSnapshot {
  ref: PullRequestRef;
  title: string;
  url: string;

  head: {
    branch: string;
    sha: string;
  };

  baseBranch: string;
  lifecycle: PullRequestLifecycle;
  mergeability: "mergeable" | "conflicting" | "unknown";

  checks: {
    summary: PullRequestChecksSummary;
    items: ReadonlyArray<PullRequestCheck>;
  };

  reviewDecision: PullRequestReviewDecision;
  autoMerge: { method: PullRequestMergeMethod } | null;

  /** Presentation hints only; GitHub still authorizes every write. */
  offeredActions: ReadonlyArray<PullRequestOfferedAction>;

  updatedAt: string;
}
```

`offeredActions` prevents the UI from recombining independent permission booleans and method arrays. It is a presentation hint derived from known lifecycle and repository capability, not an authorization guarantee. The server does not trust it when executing an action.

If repository-supported merge methods require an additional host query, keep that enrichment narrowly scoped and independently degradable. Failure to read method configuration must not erase an otherwise valid pull request snapshot; the UI may omit merge controls and retain Open on GitHub.

## Check model

```ts
interface PullRequestCheck {
  name: string;
  status: "pending" | "success" | "failure" | "cancelled" | "skipped" | "neutral";
  description: string | null;
  url: string | null;
}
```

GitHub check runs and legacy commit statuses are mapped from the current `statusCheckRollup` returned by `gh pr view`.

Aggregate rules are shared by all UI surfaces:

```text
failure or cancelled > pending > success > none
```

More precisely:

1. Any `failure` or `cancelled` check produces `failing`.
2. Otherwise, any `pending` check produces `pending`.
3. Otherwise, at least one `success` check produces `passing`.
4. No checks, or only `skipped` and `neutral` checks, produces `none`.

The first version maps the rollup GitHub provides. It does not reconstruct workflow history or introduce timestamp-based rerun deduplication unless a real `statusCheckRollup` fixture demonstrates duplicate current entries that harm the UI.

## Read flow

```text
Client calls pullRequest.current({ ref })
  ↓
RPC resolves SessionRef to workspace cwd
  ↓
PullRequestService calls GitHubCliAdapter.current(cwd)
  ↓
GitHubCliAdapter runs one primary scoped command:
  gh pr view --json <fixed fields>
  ↓
Adapter decodes and normalizes snapshot
  ↓
RPC returns PullRequestSnapshot or null
```

The fixed field set should include at least:

```text
number
url
title
state
isDraft
headRefName
headRefOid
baseRefName
mergeable
statusCheckRollup
reviewDecision
autoMergeRequest
updatedAt
```

Do not run `gh auth status` before every read. The primary command's result is the first authentication signal. An explicit authentication probe may be used only for a dedicated setup or diagnostics flow.

A missing current PR is a normal `null` result. Missing executable, authentication failure, malformed JSON, and host failure are errors.

## Action model

Use action-specific expected state rather than requiring a head SHA for every operation:

```ts
type PullRequestActionInput =
  | {
      ref: SessionRef;
      expected: {
        pullRequest: PullRequestRef;
        headSha: string;
      };
      action: {
        type: "merge";
        method: PullRequestMergeMethod;
      };
    }
  | {
      ref: SessionRef;
      expected: {
        pullRequest: PullRequestRef;
        headSha: string;
      };
      action: {
        type: "enable-auto-merge";
        method: PullRequestMergeMethod;
      };
    }
  | {
      ref: SessionRef;
      expected: {
        pullRequest: PullRequestRef;
      };
      action: {
        type: "disable-auto-merge";
      };
    };

interface PullRequestActionApplied {
  pullRequest: PullRequestRef;
  action: PullRequestActionInput["action"]["type"];
  appliedHeadSha?: string;
}
```

## Mutation flow

```text
Client submits runAction
  ↓
RPC resolves SessionRef to current workspace cwd
  ↓
Adapter rereads the current PR identity from cwd
  ↓
Server verifies submitted PullRequestRef still matches the workspace PR
  ↓
For merge or enable-auto-merge:
  gh pr merge <stable-pr-url>
    --match-head-commit <expected-sha>
    --merge | --squash | --rebase
    [--auto]

For disable-auto-merge:
  gh pr merge <stable-pr-url> --disable-auto
  ↓
GitHub accepts or rejects the action
  ↓
Server returns PullRequestActionApplied
  ↓
Client invalidates/refetches pullRequest.current({ ref })
```

The pre-action read protects session context and produces clearer stale-context errors. The GitHub mutation precondition is the race-safety boundary for head-sensitive actions.

A follow-up read may be attempted as a best-effort optimization, but its failure never changes an accepted mutation into an action error. The wire result remains an acknowledgement.

## Host authority

The UI displays checks and mergeability but does not reproduce GitHub's effective authorization policy.

Merge controls may be offered from known lifecycle and repository capability, but GitHub remains authoritative for:

- viewer permission;
- required checks;
- required reviews;
- branch protection;
- repository rulesets;
- merge queues;
- unresolved conversations;
- organization policy.

When GitHub returns an observed non-zero response, the UI shows a conservative normalized rejection plus safe bounded host detail where reliable. A timeout, output overflow, or local process I/O failure has an indeterminate mutation outcome: return `OUTCOME_UNKNOWN` and tell the user to check GitHub before retrying. Do not report an unconfirmed outcome as a rejection or automatically retry it.

## Error model

Session resolution errors remain at the RPC seam and follow existing named oRPC patterns.

Recommended public outcomes:

```text
current:
  SESSION_NOT_FOUND
  MISSING_GH
  UNAUTHENTICATED
  RATE_LIMITED          when reliably recognizable
  HOST_UNAVAILABLE
  INVALID_RESPONSE

runAction:
  SESSION_NOT_FOUND
  STALE_CONTEXT
    - workspace no longer resolves to the same PR
    - current PR identity changed
    - host rejected expected head SHA
  MISSING_GH
  UNAUTHENTICATED
  UNSUPPORTED_ACTION
  OUTCOME_UNKNOWN       local execution ended without a confirmed host result
  HOST_UNAVAILABLE      pre-action read failed before any write was attempted
  INVALID_RESPONSE      pre-action response could not be decoded
  HOST_REJECTED
  RATE_LIMITED          when reliably recognizable
```

An accepted write never enters the error channel solely because later refresh failed.

Raw argv, cwd, environment values, credentials, and complete stderr never cross the RPC seam.

## Freshness and query ownership

TanStack Query is the only owner of pull request snapshot freshness in the first version.

Configure key-wide defaults for `pullRequest.current` in `createAppClients` using the generated oRPC key:

```text
staleTime: 15 seconds
refetchOnWindowFocus: use the existing global policy
```

Only the root composition's active-session header observer adds:

```text
refetchInterval: 30 seconds while the client is visible and online
refetchIntervalInBackground: false
```

The content panel consumes the same query key without an interval. A visible, online client must converge to externally changed GitHub state within 45 seconds after that state is observable through `gh`; a hidden client refetches when focus returns.

Refresh behavior:

```text
manual Refresh
  → query.refetch()

action applied
  → settle the mutation as successful
  → invalidate exact current({ ref }) query
  → refetch

post-action refetch fails
  → retain the last snapshot
  → show `Action applied; status refresh failed` with Retry
  → never re-run the mutation automatically

navigation to another SessionRef
  → distinct generated query key
```

Do not add a server snapshot cache, cache-bypass RPC, or server invalidation epochs in V1. Add narrowly keyed server caching or single-flight only after measurements demonstrate duplicate CLI load across clients.

## Frontend integration

### Session header status

The header may display a compact, non-interactive status for the active session:

| State                    | Presentation           |
| ------------------------ | ---------------------- |
| Open with passing checks | Positive status text   |
| Open with pending checks | Warning status text    |
| Open with failing checks | Negative status text   |
| Draft                    | Muted Draft text       |
| Conflicting              | Negative conflict text |
| Merged                   | Accent Merged text     |
| Closed                   | Negative Closed text   |
| No current pull request  | No status              |

Select one compliant seam: `CardPanel` receives a narrow display-primitive model, not a feature component or generic React-node slot.

```ts
interface CardPanelStatus {
  label: string;
  tone: "positive" | "warning" | "negative" | "muted" | "accent";
}

interface CardPanelProps {
  heading: string;
  supportingText?: string;
  status?: CardPanelStatus;
}
```

The root composition owns the active-session `pullRequest.current` query, derives `CardPanelStatus | undefined` with a stable query `select`, and passes only that display model to `CardPanel`. `CardPanel` renders the generic status and knows nothing about `SessionRef`, pull requests, checks, or content-panel definitions.

The status is display-only. Users open the pull request panel through the existing content-panel picker/tab mechanism. Do not add `accessory: ReactNode`, an `onStatusClick` feature callback, or structural feature children to `CardPanel`.

### Session list status

Each active-session-list row may show one compact lifecycle icon after the session title for the branch currently checked out in that session's persisted cwd. App-owned theme variables use GitHub's classic lifecycle colors:

| State                | Light     | Dark      |
| -------------------- | --------- | --------- |
| Open pull request    | `#1a7f37` | `#3fb950` |
| Draft pull request   | `#6e7781` | `#8b949e` |
| Closed without merge | `#cf222e` | `#f85149` |
| Merged               | `#8250df` | `#a371f7` |
| No current PR/error  | No icon   | No icon   |

These variables live in `apps/app/src/index.css`, not the shared UI package.

Each project session group issues one `pullRequest.statuses({ refs })` query for its mounted rows. The RPC resolves complete `SessionRef` values, groups sessions by persisted cwd, and reads each unique cwd sequentially, preventing one simultaneous `gh` process per row. The group suppresses stale icons whenever the batch query errors.

The active row additionally observes the exact `pullRequest.current` query key shared by the header and panel. Only the active-session header owns the 30-second poll; its cache updates immediately flow to the active row. The batch query adds no interval and uses normal focus freshness.

`features/projects` renders the small lifecycle primitive from the shared contract but does not import `features/pull-request`. It does not receive a snapshot, checks, actions, or mutation capabilities.

### Pull request content panel

Add a feature-owned session-bound singleton panel:

```text
apps/app/src/features/pull-request/
├── pull-request-panel.tsx
├── pull-request-presentation.ts
└── pull-request-presentation.test.ts

apps/app/src/features/projects/
└── session-pull-request-indicator.tsx
```

The panel obtains the complete `SessionRef` from its `PanelHandle` and reads the same generated current query as the header.

Panel actions:

- Open on GitHub;
- Refresh the current query;
- Merge, squash, or rebase with confirmation;
- Enable or disable auto-merge where offered.

Merge controls remain in the panel, not the session header.

### Feature boundaries

The pull request feature must not import projects or review:

```text
features/pull-request  ✕→ features/review
features/pull-request  ✕→ features/projects
features/review        ✕→ features/pull-request
```

The route/shell composition root combines the authoritative `SessionRef`, header presentation, and panel registration.

## Suggested files

```text
packages/contract/src/
└── pull-request.ts

packages/server/src/
├── pull-request/
│   ├── service.ts
│   ├── github-cli.ts
│   ├── normalization.ts
│   ├── errors.ts
│   └── index.ts
└── rpc/
    └── pull-request.ts

apps/app/src/features/
└── pull-request/
    ├── pull-request-panel.tsx
    ├── pull-request-presentation.ts
    └── pull-request-presentation.test.ts

apps/app/src/features/projects/
└── session-pull-request-indicator.tsx
```

Composition points:

```text
packages/contract/src/index.ts
packages/server/src/rpc/router.ts
packages/server/src/rpc/context.ts
packages/server/src/rpc/runtime.ts
packages/server/test/rpc-harness.ts
apps/app/src/routes/__root.tsx
```

## Verification strategy

Automated code tests are a regression net for deterministic pie-owned behavior. They are not acceptance evidence for GitHub policy, `gh` authentication, remote resolution, eventual consistency, or the stale-head guarantee. Those properties require a real GitHub repository and a running pie server.

Test count is not a quality metric. Prefer a few tests at stable seams over one test file per type, component, error tag, or branch.

### Long-lived automated tests

Keep at most these four focused test files unless a production regression demonstrates another durable seam:

```text
packages/server/test/pull-request-normalization.test.ts
packages/server/test/pull-request-github-cli.test.ts
packages/server/test/rpc-pull-request.test.ts
apps/app/src/features/pull-request/pull-request-presentation.test.ts
```

#### `pull-request-normalization.test.ts`

Exercise pure decoding and normalization using a small set of sanitized JSON fixtures captured from real `gh pr view --json ...` output. Keep fixture provenance beside each sample: GitHub host type, `gh` version, capture date, and represented state.

Cover only distinctions owned by pie:

- open draft, open non-draft, closed, and merged lifecycle mapping;
- CheckRun and legacy commit-status mapping;
- failure/cancelled precedence over pending and success;
- empty or neutral-only checks mapping to `none`;
- review decision and auto-merge mapping;
- malformed required fields failing explicitly.

Do not hand-author an exhaustive fake GitHub schema. One representative fixture per materially different JSON shape is enough.

#### `github-cli.test.ts`

Use a minimal recording `ChildProcessSpawner` at the existing Effect service boundary, not a simulated GitHub implementation. Verify the stable command boundary:

- read uses workspace cwd and the fixed JSON field list;
- no unconditional auth preflight precedes the primary read;
- mutations target stable PR identity;
- merge and enable-auto-merge include `--match-head-commit`;
- disable-auto-merge omits an unnecessary head precondition;
- executable and argv are passed directly rather than through a shell;
- public errors and telemetry do not contain raw argv, cwd, or captured output;
- the adapter uses the existing `ChildProcessSpawner` boundary with direct argv, cwd, prompt suppression, and bounded collected output.

This test proves pie-owned command construction and adapter wiring only. It does not prove that GitHub honors the flag, that a particular stderr sentence means authentication failure, or that a fork resolves correctly.

#### `pull-request-rpc.test.ts`

Use a real temporary repository/worktree and the existing RPC harness. Stub only the private GitHub adapter result so the test remains about the RPC seam:

- a complete `SessionRef` resolves through `resolveWorkspaceCwd`;
- the internal service receives the worktree cwd;
- a missing Session produces the established RPC error;
- action acknowledgement is returned without requiring a refreshed snapshot.

Do not reproduce GitHub remote selection in this test. That is not the RPC adapter's responsibility.

#### `pull-request-presentation.test.ts`

Test only pure presentation decisions:

- lifecycle/check summary to `CardPanelStatus` mapping;
- no status for no current PR;
- offered-action visibility for the discriminated snapshot states;
- pending mutation suppressing conflicting action controls.

Do not snapshot the whole panel DOM or test TanStack Query, oRPC, Radix, tooltip, button, or Content Panel library behavior through this feature.

### Tests not worth adding initially

Do not add standalone tests for:

- TypeScript unions that the compiler already enforces;
- every contract field getter or error constructor;
- generated oRPC query-key shapes;
- TanStack Query's own invalidation, polling, and observer semantics;
- every icon, color, tooltip, or wording variant;
- every GitHub stderr phrase;
- every combination of checks, reviews, draft state, and mergeability;
- fake fork, multiple-remote, ruleset, branch-protection, or merge-queue behavior;
- fake GitHub rate limiting or eventual consistency;
- implementation details such as private Effect call order.

A mock-heavy test that restates the implementation can remain green while real `gh` or GitHub behavior changes. Add such a test only after a production regression and make it reproduce the smallest pie-owned rule that would have prevented that regression.

### Environment-dependent properties

The following cannot be meaningfully guaranteed by ordinary code tests:

- local `gh` installation and authentication state;
- account and organization permissions;
- branch protection, repository rulesets, required reviews, and merge queues;
- repository-enabled merge methods;
- real fork and multiple-remote resolution;
- GitHub Enterprise host behavior;
- GitHub's interpretation of `--match-head-commit`;
- timing of checks, auto-merge, and eventual consistency;
- human-oriented stderr wording across `gh` versions;
- network interruption, rate limiting, and service degradation;
- convergence across independent pie clients;
- operating-system process limits and child cleanup.

Do not encode these as large mock matrices. Verify them through the runtime acceptance protocol below.

## Runtime acceptance protocol

### Environment

Use a dedicated GitHub sandbox repository with real GitHub Actions, auto-merge, and configurable merge methods. Record:

- pie commit;
- operating system;
- `gh --version`;
- GitHub host;
- authenticated account class;
- repository settings and active rulesets;
- acceptance start and end timestamps.

Run the complete protocol against the real standalone pie server and Vite app with two independent browser contexts and a second repository checkout for competing pushes. Also run a packaged macOS Electron smoke covering current-PR resolution, one accepted mutation, refresh, local `gh` discovery, and clean app shutdown. An unpackaged browser run does not prove the shipped Electron environment and PATH behavior.

If another packaged OS becomes an advertised release target, add the same smoke there before claiming support. Do not use mocked GitHub APIs for release acceptance.

### Real GitHub state matrix

Verify at least these live states:

| Scenario                     | Required observation                                     |
| ---------------------------- | -------------------------------------------------------- |
| Branch without a PR          | Header remains quiet; panel reports no current PR        |
| Open PR without checks       | Summary is `none`, never passing                         |
| Pending workflow             | Header and panel show pending                            |
| Failed or cancelled workflow | Header and panel show failing and identify the check     |
| Passing workflow             | Header and panel show passing                            |
| Draft PR                     | Draft presentation is shown                              |
| Conflicting PR               | Conflict is shown and GitHub rejects merge               |
| Closed PR                    | Closed presentation is shown                             |
| Merged PR                    | Merged presentation is shown                             |
| Auto-merge waiting           | Auto-merge is shown as enabled                           |
| Auto-merge completes         | UI converges to merged without manual reload             |
| Disabled merge method        | Controls omit it or host rejection is presented honestly |

The sandbox workflow should be able to pass, fail, sleep, and be cancelled so these states are reproducible without editing pie.

### Workspace and remote identity

Create one Project with at least two pie worktree Sessions whose branches have different PRs. Verify each Session shows and mutates only its own PR.

Run real fixtures for:

- a normal same-repository branch;
- a fork PR;
- multiple remotes;
- detached HEAD;
- GitHub Enterprise only if V1 claims Enterprise support.

An unsupported fixture must produce an explicit outcome; silently choosing another repository or PR is a release blocker.

### Atomic stale-head scenarios

These scenarios are mandatory and cannot be replaced by command-construction tests. Run them against separate disposable PRs for both `merge` and `enable-auto-merge`:

1. Open the PR in pie and record head SHA A.
2. Leave the action confirmation open.
3. Push head SHA B from the second checkout.
4. Confirm the stale action from pie.
5. GitHub must reject it because pie sent `--match-head-commit A`.
6. The PR must remain open; it must neither merge nor become auto-merge-enabled.
7. pie must show stale context rather than a generic host failure.
8. Refresh must show SHA B; only a newly confirmed action may proceed.

Retain both PR URLs, both pairs of SHAs, UI captures, and safe server log excerpts as evidence.

### Applied action followed by failed refresh

Prove the acknowledgement invariant with runtime fault injection:

1. Perform merge or enable-auto-merge against the real sandbox.
2. Let the pre-action `gh pr view` and real `gh pr merge` complete successfully.
3. Make only the first subsequent `gh pr view` fail. An acceptance-only shim may delegate every command to real `gh`, write a marker after a successful `gh pr merge`, and fail the next matching `pr view`; it must not count unrelated invocations.
4. The mutation must settle as successful. The UI must retain the last snapshot and show `Action applied; status refresh failed` with Retry; it must not report that the mutation failed or automatically repeat it.
5. Confirm the action independently on GitHub.
6. Restore normal `gh` execution, choose Retry, and verify the query converges.

The acceptance shim is not a production mock and must not be used as proof of GitHub semantics; it exists only to inject a failure at the boundary between an accepted write and its client-owned refresh.

### Multi-client convergence

With two independent browser contexts viewing the same Session:

- merge externally on github.com and verify both visible clients converge within 45 seconds after the merged state is observable through `gh`;
- perform a mutation in one pie client and verify the other converges without manual reload;
- confirm the panel does not create a second polling loop when opened;
- navigate one client to another `SessionRef` and verify cache state does not bleed between Sessions.

### Authentication and degradation

Run pie with:

- `gh` absent from `PATH`;
- `gh` installed but logged out;
- valid github.com authentication;
- an expired or revoked credential;
- a second host only when that host is in scope.

Verify actionable, conservative errors and no retry storm. Scan logs with a unique credential canary and confirm that tokens, authorization values, full argv, cwd, and complete command output are absent.

### Process hygiene under operational pressure

Drive ten concurrent real current-PR reads across multiple Sessions while observing OS process state. This is a leak and responsiveness check, not acceptance of a process-wide concurrency ceiling; V1 deliberately defines no such scheduler.

Verify:

- the daemon health endpoint remains responsive;
- each `gh` child exits after its request;
- process count returns to baseline after the run;
- memory and file-descriptor counts do not grow monotonically;
- timeout or app shutdown leaves no adapter-owned `gh` child.

If measured production load shows that unconstrained simultaneous `gh` requests are unsafe, design the shared command policy separately rather than growing a private PR scheduler.

### Soak

Before V1 release, run the feature for at least 30 minutes with two clients, multiple Sessions, polling, external check transitions, one merge, one auto-merge, and one network interruption. Verify eventual client agreement, bounded process/resource use, and no duplicate polling amplification.

### Required evidence

Store non-secret artifacts outside Git history under a run-specific directory:

```text
artifacts/pr-acceptance/<run-id>/
├── environment.md
├── scenarios.md
├── github-pr-urls.md
├── screenshots/
├── server-log-excerpt.txt
├── process-samples.txt
├── resource-usage.txt
└── result.md
```

Every scenario records `PASS` or `FAIL`, actual behavior, evidence paths, and residual risk. A checked box without evidence is not acceptance.

Run the complete protocol for the first release and after changes to PR identity resolution, mutation construction, freshness ownership, or the private `gh` execution helper. Ordinary presentation-only changes need only the relevant live smoke scenarios.

## Delivery phases

### Phase 1: read-only current pull request

- Add contract, RPC adapter, service, and private GitHub CLI adapter.
- Resolve `SessionRef` to cwd at the RPC seam.
- Implement one primary `gh pr view` read and normalized snapshot.
- Add the shared current query, header status, and content panel.
- Add Open on GitHub and query refetch.

### Phase 2: merge actions

- Probe or require `gh` support for `--match-head-commit`.
- Add merge, squash, and rebase.
- Target stable PR identity and use the host-side head precondition.
- Return action acknowledgement.
- Invalidate/refetch the current query after success.

### Phase 3: auto-merge

- Add enable-auto-merge using the same host-side head precondition.
- Add disable-auto-merge without an unnecessary head precondition.
- Preserve acknowledgement/refresh separation.

### Phase 4: measured improvements only

After observing real behavior, consider:

- a narrowly keyed server single-flight or cache for duplicate multi-client reads;
- repository merge-method enrichment;
- bounded post-action read retry as a UX optimization;
- explicit local repository resolution for demonstrated `gh pr view` failures;
- project-level PR lists;
- pull request creation, comments, or review threads;
- a provider seam after a second production provider exists;
- a reusable bounded command executor after a second finite-command consumer and measured contention justify it.

## Open questions

1. Is GitHub Enterprise an explicitly tested V1 guarantee or deferred scope?
2. Should repository-supported merge methods be read in V1, or should the UI offer GitHub's three methods and normalize host rejection?
3. Which `gh` capability-probe strategy should enforce support for `--match-head-commit`?
4. Which stderr patterns are stable enough for distinct unauthenticated and rate-limited errors without brittle parsing?
5. What explicit outcome should represent an ambiguous or unsupported current-PR resolution fixture?

## Release gate

Automated tests are necessary but not sufficient. V1 is accepted only when both gates pass.

### Automated regression gate

- the four focused test files described above pass;
- real captured JSON fixtures cover every materially different supported payload shape;
- command-construction tests prove head-sensitive actions include `--match-head-commit`;
- no additional mock-heavy GitHub suites have been added without a documented production regression or public invariant.

### Runtime acceptance gate

- the real GitHub state matrix passes;
- two worktree Sessions resolve and mutate different PRs without state bleed;
- competing-push stale-head scenarios for both merge and enable-auto-merge are rejected by GitHub and leave the PR open without auto-merge enabled;
- an applied action remains successful when the following refresh fails;
- two independent clients converge after external and in-pie changes;
- missing and unauthenticated `gh` produce actionable outcomes;
- the operational-pressure run remains responsive, returns process/resource counts to baseline, and leaves no adapter-owned `gh` child after shutdown;
- an indeterminate local mutation failure is presented as `OUTCOME_UNKNOWN` and never as a confirmed rejection or automatic retry;
- standalone browser and packaged macOS Electron acceptance scenarios pass;
- the credential canary is absent from logs and artifacts;
- the 30-minute soak has no duplicate polling amplification or monotonic process/resource growth;
- every blocker has retained evidence and no unresolved high-severity residual risk.

GitHub Enterprise is part of the gate only if V1 explicitly claims Enterprise support. Unit, component, RPC, and mocked adapter tests alone can never satisfy the runtime gate.
