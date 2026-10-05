# Pie Hub: Environment-bound Schedule ingress

Status: proposed, not implemented. Rebased against `origin/main` at `f6912c31`.
This revision replaces the earlier daemon-only proposal with the implemented
[Environment routing model](../adr/0005-environment-rpc-routing.md). Decisions
marked **approval required** are not authorization to implement host writes.

## 1. Current baseline, not proposed capabilities

| Existing capability                                                                                       | Consequence for Hub                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A daemon has a persistent UUID in `$PIE_HOME/storage/environment-id`, exposed by `/api/environment`       | Reuse that Environment identity; never mint a second machine id                                        |
| One daemon/writer per `$PIE_HOME`; lifecycle files are under `daemon/`                                    | Enrollment belongs to the target daemon home, not Desktop or the CLI's home                            |
| Installed home is `~/.pie`; checkout home is branch-derived                                               | Use `Paths`; neither `NODE_ENV` nor the removed `PIE_DAEMON_DIR` selects daemon identity               |
| `EnvironmentRpc.for(environmentId)` binds every call and cache key                                        | Schedule editing, Hub administration, and session navigation must use the same Environment             |
| SSH, LAN, Tailscale, relay, and browser pairing provide access to a daemon                                | They are access paths, not Hub enrollment or execution authority                                       |
| Node daemon hosts a Bun `pie-pi-process` built from the Pi SDK                                            | Hub starts neither; no dependency on a user-installed `pi` executable                                  |
| Schedule exposes `runNow(id)`; internal `fire` owns session selection, run records, prompt and settlement | External fire is a new interface to that implementation, not an existing `ScheduleService.fire` method |
| `claimInFlight` and a scoped Schedule runtime already exist                                               | Extend these protections rather than creating a second live-session table                              |
| Schedule-created sessions use the Schedule name as their initial title                                    | Preserve this; do not promise first-prompt titles or add Session origin metadata for a badge           |

Two current baseline facts also constrain execution. A prompt Pi queued after Pie
already consumed its finish event is attached and streamed, not rejected as an
inactive turn; do not treat that race as a failed admission. Creating a Session
with an explicit model writes Pi's shared default outside `$PIE_HOME`
(`persistDefaultPiModel`). That write is not Environment-local and is not
isolated by a second Pie home.

Hub packages, contracts, connectors, trigger fields, and commands do not exist
on this baseline. Neither `CONTEXT.md` nor this proposal is implementation proof.

## 2. Product boundary and first working path

Hub receives external events. An **Environment** executes them through its
existing Schedule. Desktop observes that Environment through its ordinary RPC
connection; it does not forward Hub work to another machine.

```text
GitHub --signed webhook--> public pie-hub
                                ^
                                | authenticated outbound WSS
                                |
                       selected Environment's Node daemon
                         Schedule -> Session -> Bun Pi child
                                ^
                                | existing authenticated RPC
                                |
                  Desktop / web / CLI (independent of Hub)
```

Keep the previous V1 limit: one operator, one enrolled Environment per Hub,
and one Hub relationship per Environment. A Desktop may still connect to many
Environments; the enrolled one may be local or remote. Multiple Environments
per Hub would require explicit target selection and conflict policy; do not
silently add load balancing, first-online routing, fan-out, or failover.

Example: Desktop on a laptop connects to laptop A and build-box B. The user
selects B, registers its Project, creates its Schedule, and enrolls B. GitHub
work runs on B even after Desktop exits or its SSH tunnel closes. Enrolling B
must not create a credential, Project, Schedule, or Session on A.

Retain: GitHub as a Schedule trigger, independent public binary, outbound
connector, no offline queue, no caller-supplied paths, no workflow YAML.
Proposed scope reductions requiring confirmation are listed in section 10.

| Owner                                        | Responsibility                                                    | Forbidden                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/hub`, `@getpie/hub`, bin `pie-hub` | Public webhook, enrollment HTTP, daemon socket, delivery receipts | Pi, workspace access, daemon RPC proxy, SPA, imports of server/CLI     |
| `packages/server/src/hub/`                   | Target-local relationship, connector, execution receipts          | Starting Hub, selecting another Environment, exposing a public webhook |
| Schedule module                              | External admission, existing fire path, authoritative run outcome | Owning a WebSocket or importing HubConnector                           |
| `packages/pie`                               | Project proposed Hub administration contract onto CLI             | Writing relationship files or choosing a focused Desktop Environment   |
| `packages/contract`                          | Validated Hub frames and daemon administration contract           | Runtime implementation imports                                         |

Hub's product-domain dependency is the contract leaf. Effect/platform,
`@getpie/effect-json-store`, and appropriate shared `core` primitives are allowed.
Node-only V1 is proposed; no speculative Bun host, pull-transport interface,
Worker/DO adapter, Hub clock, Slack union, or remote-control frame.

## 3. Identities, authority, and Environment lifecycle

These identities must remain distinct:

- `environmentId`: existing daemon UUID; identifies the execution location, not
  a hostname, SSH alias, URL, credential, or proof of ownership.
- `relationshipId`: revocable authority binding one Hub to that Environment.
- `scheduleId` and `runId`: job and individual run inside the Environment.
- `executionId`: Hub dispatch identity; never a Session id.
- `SessionRef`: unchanged daemon wire identity `{ projectId, sessionId }`.
  Outside that daemon, address a session with `{ environmentId, ref }`, matching
  the app's existing `EnvironmentSessionRef` shape.

Enrollment authenticates both sides and pins `environmentId`. Socket identity
comes from the authenticated relationship; a hello cannot switch it. The daemon
also compares its own UUID with the enrollment and dispatch targets. The serve
composition passes the UUID already loaded by `loadOrCreateEnvironmentId` into
Hub administration and the connector; neither generates or independently caches
a second identity. A mismatch fails closed, with no attempt to find a similarly
named Project elsewhere.

URL/token rotation on a UI connection does not reenroll the daemon. Removing an
Environment from Desktop removes its RPC link/cache, not its Hub relationship.
`pie hub disconnect` stops future Hub admission, not already-started Sessions or
all other UI access. Stopping the daemon makes dispatch unavailable; reconnect
must present the same relationship and Environment identity. A second live
socket for that relationship is rejected until the old one closes or times out.

An independently cloned `$PIE_HOME` also copies identity and secrets. Running
both copies is unsupported; never interpret that as two Environments or silently
replace the first socket. Re-enrollment is required after creating a genuinely
new Environment. This RFC does not introduce an identity-reset command.

### Administrative access is not Hub execution access

Existing browser pairing grants daemon RPC access; relay transports daemon
traffic. Neither is a restricted event-dispatch credential. Reuse their access
paths to administer the target when appropriate, never their tokens on Hub WSS.
The Hub socket may fire eligible Schedules and query its own execution receipts;
it may not read arbitrary Sessions, files, settings, credentials, or terminals.

Proposed daemon RPCs: `hub.connect`, `hub.status`, `hub.refresh`, `hub.disconnect`. Every
mutation carries `expectedEnvironmentId` and checks it against the actual daemon.
They require authenticated daemon access; tokenless `pie serve` must reject them.
Responses never expose a relationship credential or an enrollment token.

CLI uses `packages/pie/src/node/connect.ts`: `--url` / `PIE_URL` is connect-only,
otherwise resolve the local daemon. No `--environment-id` that guesses a URL.
For remote setup, use the existing secure tunnel/HTTPS access or run the CLI on
the target over SSH. Do not forward enrollment secrets over cleartext remote
LAN/relay HTTP. Desktop calls `environmentRpc.for(environmentId).hub.*`.

### Candidate enrollment flow — approval required

Replace the unimplemented password/login store with a high-entropy operator
bearer supplied to the Hub process by the operator's secret manager. This is an
administration secret, distinct from the webhook secret and daemon UI bearer.
No operator password database, persistent CLI login, or `login/logout` commands.

1. Operator calls `POST /operator/enrollment-tokens`, authenticated with that
   bearer, specifying the expected Environment UUID. Hub mints a 256-bit random
   enrollment token, valid for ten minutes, at most ten pending tokens.
2. Proposed `pie hub connect` takes a Hub origin, `--expected-environment-id`,
   `--token-stdin`, and optional daemon `--url`. It sends the token through
   authenticated target RPC. No secret in argv, URLs, stdout, or logs.
3. The target daemon generates a relationship UUID and a 256-bit credential and
   locally persists a **pending** relationship before calling `POST /enroll`
   with those values, its Environment UUID and the enrollment token. Hub pins
   the token's UUID and stores only the credential hash. One serialized token
   consumption creates one relationship; an occupied Hub returns a conflict.
4. Daemon authenticates WSS with the new credential. An acknowledged handshake
   promotes local pending state to active. If `/enroll` acknowledgment was lost,
   retry authentication with the same pending credential, not enrollment with a
   newly generated secret. If never enrolled and the token is expired/lost,
   report enrollment incomplete; explicit connect with a fresh token is required.
5. `hub.status` returns Environment UUID, origin, relationship id, pending/active/
   disconnected/revoked state, connectivity and a safe error code. Restart drops
   unused enrollment tokens; it does not discard enrolled relationships.

Origin must be HTTPS, except exact loopback HTTP for isolated development.
Reject URL userinfo, query, fragment, unexpected paths, redirects, and TLS
verification failures. WebSocket auth uses headers, not URL query parameters.
Version 1 is negotiated before accepting hello or dispatch.

Disconnect disables local admission first and attempts credential-authenticated
Hub revocation. If Hub is unreachable, retain a disabled revocation-pending local
record and report that remote revocation is unconfirmed. Operator can revoke via
`DELETE /operator/relationships/<id>`; revoke persists before closing sockets.
Neither operation deletes run history or treats already-started work as canceled.
After revocation, remove the local raw credential; re-enrollment gets a new id.
CLI disconnect requires `--expected-environment-id` and `--yes`. Refresh uses
status to pin the target UUID for that operation; neither command infers a
Desktop selection.

## 4. Schedule authorization and routing

Proposed trigger is only absent/local or GitHub:

```ts
type ScheduleTrigger =
  { kind: "local" } | { kind: "github"; relationshipId: string; mention?: string; label?: string };
```

The relationship binding prevents a newly enrolled Hub from inheriting old
Schedules implicitly. Rebinding requires an explicit Schedule update. Missing
trigger means local; updating to `{ kind: "local" }` clears the binding.

GitHub requires `spec.kind === "manual"`, an active relationship, and a
registered Project with a supported GitHub remote. The selected Environment
owns all of those checks. Local clock specs and local Run now remain unchanged;
manual Run now on a GitHub row is an explicit user action with reason `manual`,
not a synthetic GitHub event. Disconnected rows remain editable/deletable, but
cannot be enabled or rebound without an active relationship.

Repository identity is `{ host: "github.com", owner, repository }`, lowercased,
with one trailing `.git` removed. V1 accepts normal HTTPS, `git@github.com:` and
`ssh://git@github.com/` fetch URLs; reject arbitrary hosts, local paths, URL
credentials, malformed owner/repository segments and unsupported forms. Do not
resolve SSH aliases or support Enterprise implicitly. The daemon reads each
Schedule's own Project remotes, deduplicates them, and never chooses the first
matching Project across the Environment. Non-git/chat Projects advertise nothing.

`hub.hello` contains protocol version, pinned Environment/relationship ids and
only eligible schedules: `{ scheduleId, repositories, trigger }`. No Project
paths, prompt, credentials, session list, or top-level all-Projects remote index.
Exactly one matching Schedule is required. Zero gives `no_schedule`; more than
one gives `ambiguous_schedule`; neither fires anything.

Hello replaces the connection's entire advertisement atomically. Send on
connect/reconnect and after any committed change affecting eligibility: CRUD,
trigger switch, pause/resume, expiry, failure circuit, max-runs, Project removal.
A private post-commit notification wired at composition is sufficient; Schedule
must not import the connector or wait for network success. Coalesce dirty
notifications; reconnect rebuilds from current records, not queued deltas.

External `git remote set-url` has no existing Pie event. Discover it on reconnect,
an explicit `hub.refresh` daemon RPC/CLI command, and a bounded 60-second
connector refresh while connected. Re-read the target Project's remotes at fire
admission. An old hello may reject a legitimate event temporarily; it must not
authorize execution against the wrong repository.

## 5. Webhook and wire contracts

Only `issue_comment.created`, `pull_request_review_comment.created`, and
`issues.labeled` are eligible. Edited/deleted comments, push and synchronize do
not fire. Verify HMAC-SHA256 over the bounded raw body using constant-time
comparison before decoding the payload. Require valid event/delivery headers,
JSON content type, and a non-empty startup `fromUsers` allowlist; compare GitHub
logins case-insensitively. A comment matches a literal mention token (not a regex
or a substring of a longer handle); a label matches case-insensitively. Per-row
overrides take precedence over Hub defaults `@pie` and `pie`.

Normalized dispatch is a validated structure, not a rendered prompt to reparse:

```ts
type CreateExecution = {
  version: 1;
  type: "hub.execution.create";
  executionId: string;
  deliveryId: string;
  relationshipId: string;
  environmentId: string;
  scheduleId: string;
  issuedAt: string; // timezone-aware ISO; fixed on first admission
  expiresAt: string; // issuedAt + 60 seconds; retries never extend it
  trigger: {
    kind: "github";
    repository: { host: "github.com"; owner: string; repository: string };
    actor: string;
    issueNumber: number;
    issueUrl: string;
    title: string;
    event:
      | { kind: "issue_comment"; commentId: number; body: string }
      | { kind: "pull_request_review_comment"; commentId: number; body: string }
      | { kind: "issues_labeled"; label: string; body: string };
  };
};
```

Validate UUIDs, positive safe-integer GitHub ids, canonical GitHub URLs matching
the repository/issue, field lengths, and discriminants at both receivers. Body
is limited to 16,000 characters, title to 256; reject rather than silently
truncate oversized context. Render bounded JSON-escaped untrusted context after
the unchanged Schedule instructions. Store that effective prompt in the existing
run snapshot, not by modifying the Schedule's saved prompt. Delimiters are not a
sandbox: enrollment authorizes agent execution with that Environment's privileges.

Responses always include `executionId` and `environmentId`:

- `accepted`: `runId`, complete `ref`; means Schedule run persisted and prompt
  submission admitted, not successful completion.
- `rejected`: a stable code (`schedule_missing`, `project_missing`, `disabled`,
  `expired`, `wrong_trigger`, `repository_mismatch`, `busy`, `max_runs`, `invalid_context`,
  `relationship_mismatch`, `environment_mismatch`, `create_failed`,
  `admission_expired`, `clock_skew`, `execution_conflict`, `capacity_exceeded`).
- `pending`: same request is already admitted in this process.
- `outcome_unknown`: execution may have produced effects; never retry as new work.

A status lookup with no receipt returns `not_found`, never starts execution,
and never authorizes a fresh create after its admission deadline.
No `workspace` or raw error strings cross to Hub. No archive/interrupt frame in
V1: existing authenticated Environment RPC remains the control plane.
`hub.execution.status` can ask only for an execution belonging to the authenticated
relationship. Responses and sparse updates reuse the same receipt schema, with
`running | succeeded | failed | interrupted | outcome_unknown` run outcome and
optional `runId/ref` where known. `idle` is not an execution success state.

HTTP: invalid signature/actor is 403; malformed input is 400; oversized is 413;
unsupported action is 204 without a delivery record. A validated delivery gets
202 only after its receipt is persisted (including no-match/offline outcomes);
its duplicate returns 200 with the existing safe receipt, not a new dispatch.
Persistence failure is 503. A conflicting body under the same delivery id is 409. HTTP response never waits for a model run.

Initial limits: raw body 1 MiB, WS frame/hello 64 KiB, at most the existing 50
Schedules, 10-second header/body deadlines, 30-second heartbeat and two missed
heartbeats to close a socket. Limit operator-auth/enrollment failures to five per minute
per source and cap total pending unauthenticated upgrades at 32. Bound concurrent
webhook handling; excess work gets 429, not an unbounded in-memory queue.
Untrusted requests never write arbitrary ids as paths or log complete bodies,
secrets, argv, local paths, or unsanitized peer errors.

## 6. At-most-once admission, not exactly-once effects

A successful-ref map written after `fire` is insufficient. Proposed guarantee:
**at most one Schedule fire attempt per admitted execution across connection loss
and process restarts, while receipts are retained**. In an uncertain crash
window, prefer lost work with `outcome_unknown` over a duplicate prompt.
This does not guarantee exactly-once agent tools, external writes, power-loss
recovery, or recovery after restoring/deleting receipt files.

### Hub ingress

Serialize claim by `X-GitHub-Delivery`; persist the raw payload SHA-256 for
webhook conflict detection, plus target and minted `executionId`, before any
send. The daemon fingerprint is SHA-256 of the canonical validated create frame
(including target, context and fixed deadline); reconnect changes none of it. Duplicate delivery never
rematches against new Schedules. Offline at admission is a terminal
`daemon_not_connected` outcome, not deferred work. An online dispatch receives
one fixed 60-second admission deadline, carried on the create frame and retained
in the fingerprint. Require `expiresAt === issuedAt + 60 seconds`; reject a new
request after its deadline or with `issuedAt` over 30 seconds in the daemon's
future. Clock synchronization is an operational prerequisite; retries never
extend the window.

After lost acknowledgment, Hub may repeat the same create within that deadline.
After it expires, query status only. Hub restart does not replay creates; query
already-dispatched execution receipts on reconnection. A delivery persisted but
not conclusively sent becomes `outcome_unknown`, not a new execution. Persisted
terminal rejection, including offline/no-match, stays terminal on redelivery.

### Daemon admission and crash windows

Authenticate the relationship and Environment first, then look up the execution
receipt **before** loading the Schedule or checking the admission deadline. An
already-known execution remains deduplicated after expiry or Schedule deletion.
For new executions, validate the deadline, Schedule trigger, repository,
enabled/expiry/circuit/cap and session policy. Checks and admission share a
Schedule-local gate with updates, deletes and other fire callers; existing
`claimInFlight` still protects live execution. A pause ordered before admission
prevents fire; a pause after admission affects future runs, not admitted work.

1. Under execution-key serialization, read the receipt. Same fingerprint returns
   the recorded state; a different fingerprint is `execution_conflict`.
2. Persist rejection for a denied new request, or `claimed` for an admitted one,
   **before session/worktree creation or prompt submission**.
   A failed claim write produces no execution effects.
3. Use Schedule's existing session selection/create path. Before prompt submission,
   persist `runId/ref` into the receipt and persist the Schedule running record.
   Any failure prevents prompt submission; do not fork past the persistence gate.
4. Submit the prompt once through Schedule's scoped runtime. Report acceptance
   only after the persistence gate. Socket loss does not cancel the admitted run.
5. Mirror confirmed Schedule settlement into the receipt before notifying Hub.
   Failed receipt writes remain recoverable/unknown, never imply success.

After process restart, a `claimed`/incomplete receipt is never fired again. Read
any recorded run for a known outcome; otherwise expose `outcome_unknown`.
Schedule recovery already marks leftover running records `interrupted`; report
that honestly. Do not inspect Pi transcripts to guess whether tools ran. A crash
after session creation but before recording its ref can leave an unused Session
or worktree; retain it for explicit cleanup, never compensate by firing again.

A receipt is not another Schedule store: it holds identity, fingerprint,
admission state, run/ref and safe outcome, not cadence or mutable job definitions.
The Schedule's 20-run window is not a dedupe store. Receipt lookup must still
suppress dispatch after the Schedule/run/Session was deleted. No hidden automatic
retry creates a new execution id; a new GitHub event is an explicit new request.

Current settlement waits up to about 60 seconds (300 attempts, 200ms apart) and
can still record failure while a Session remains busy. The queued-after-finish
race is observed, not an immediate admission error. Report the stored Schedule
result, not task correctness or GitHub success. Do not add a second completion
detector in Hub. Deleting a Schedule before settlement, or losing the
authoritative result, yields unknown rather than inventing a successful outcome.

## 7. Observation and GitHub write-back

Schedules and Sessions remain visible in their own Environment. Use the existing
catalog/stream hydration, not a Hub-provided fake Environment or session list.
Session navigation carries `environmentId`, `projectId`, and `sessionId`.
If the Environment is unavailable to this client, show it as unavailable; never
fall back to local. Hub enrollment does not make that Environment automatically
reachable from a browser or Desktop.

The Trigger picker reads `hub.status` and Schedule data through the route's
Environment-bound oRPC surface. Explicit environment selection is preserved when
opening the editor or result. No app-global connected-to-Hub boolean.

**Proposed V1 cut, approval required:** dispatch receipts, Schedule history and
ordinary Sessions are the first usable result. Defer Session `source`/badge and
automatic GitHub reactions/comments. No new Session metadata shape is needed.
Absence of `source` never proves a Session was created by a human.

If write-back remains a V1 requirement, it is a separate slice after dispatch:
use the target Environment's `gh`, typed event/comment targets, independent
write-back status and a reviewed duplicate-comment policy. Existing PR adapter
has no comment/reaction interface; sharing its command execution does not grant
that capability automatically. Hub has no GitHub credentials, so offline,
unknown-repository and no-Schedule outcomes are logs/receipts only. Never promise
Hub reactions while delegating all credentials to an unavailable daemon.

## 8. Persistence approval worksheet — not shipped inventory

The [host-write gate](../../.agents/rules/topics/persistence.md) requires Developer
confirmation before choosing formats or implementing these writes. The following
is the candidate to review, not an approved migration plan. Once approved, update
[host-persistence.md](../host-persistence.md) in each implementing slice.

| Candidate location / owner                                            | Data, scope and lifecycle                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$PIE_HUB_HOME` (default `~/.pie-hub`), Hub-only path resolver        | Independent root; explicit absolute override for lab/dev, no `NODE_ENV` switch or daemon-home reuse                                                    |
| Hub `config.json`                                                     | Non-empty actor allowlist, default mention/label; operator-supplied validated configuration, no automatic empty seed                                   |
| Hub `relationship.json`                                               | At most one record: relationship id, Environment UUID, credential hash, active/revoked state and timestamps; no URL to daemon, prompt or remotes       |
| Hub `deliveries/<deliveryId>.json`                                    | Fingerprint, execution id, pinned target, admission deadline, dispatch state, safe outcome and timestamps; no raw webhook/body or model transcript     |
| Daemon `$PIE_HOME/hub/relationship.json`, target daemon writer only   | Origin, Environment UUID, relationship id, pending/active/disabled state, raw credential and timestamps; credential removed after confirmed revocation |
| Daemon `$PIE_HOME/hub/executions/<relationshipId>/<executionId>.json` | Fingerprint, schedule id, admission state, optional run/ref, outcome and timestamps; no prompt copy                                                    |
| Existing Schedule file, ScheduleRepository                            | Trigger binding, `github` run reason, effective per-run snapshot and execution correlation; existing 20-run retention and fired counter remain         |

Candidate storage rules needing explicit approval:

- New Hub/daemon Hub trees are owner-only (`0700` directories, `0600` files and
  temps). Do not assume umask or a later chmod protects secret creation. Existing
  `writeFileAtomic` supports mode, but document/collection APIs do not expose it;
  propagate a mode option before using those APIs for credentials. No encryption
  promise beyond host permissions; refuse symlinked credential files/roots.
- New records use version-1 envelopes, no legacy adoption. Missing enrollment
  means disabled; corrupt/newer records disable Hub admission without reset and
  do not prevent unrelated local Sessions. Hub refuses startup if its state is
  unreadable. Migration failure leaves original bytes intact.
- Current Schedule files are version-1 envelopes with no migration chain.
  Schedule must advance to version 2 with explicit v1 migration: an old binary
  must refuse Hub-trigger rows, not drop unknown authorization fields on save.
  Downgrade requires a stopped-daemon, operator-approved backup restore; do not
  promise that optional fields alone make rollback safe.
- A Schedule run that selects `provider`/`modelId` persists Pi's shared default
  model outside `$PIE_HOME`. Do not put that write in a Hub tree or claim
  Environment isolation for it. Proof that uses an explicit model stays
  serialized and must not guess-restore the previous default.
- Hub uses one process-lifetime OS-backed lock per real home, acquired before
  loading cached records; reuse the daemon SQLite `BEGIN IMMEDIATE` lock
  pattern, not PID deletion. This is a lock, not a second business database. The
  daemon continues to use its existing one-writer-per-home rule. JSON operations
  and admission each serialize at their own keys; no claim of multi-file atomic
  transactions.
- Atomic rename covers process-failure windows, not durable commits through
  sudden power loss. If power-loss dedupe is required, decide fsync/database
  durability before implementation; do not label today's JSON writer durable
  enough for that guarantee.
- No automatic receipt pruning in V1: deleting them reopens duplicate execution.
  Bound each side to 100,000 receipts; at the cap refuse new admissions but keep
  duplicate/status access working. An explicit later compaction/tombstone design
  is required for indefinite operation. No raw context on Hub disk; on the daemon
  it remains in the ordinary run snapshot and Pi conversation history.
- Disconnect/revoke retains receipts and Schedule history; delete neither user
  checkouts nor Pi state. Credential revocation and erasure are distinct from
  receipt retention. Uninstall retains both homes; deleting them is an explicit
  operator action that also discards dedupe guarantees. Never silently clear a
  corrupt receipt to make a request work.
- Hub emits bounded/redacted structured stdout/stderr only; deployment tooling
  owns its log sink/retention. Daemon reuses existing `pie.log`, no new log file.
  Operator/webhook secrets remain deployment inputs; enrollment tokens are
  memory-only and expire. No new Desktop/browser store or CLI login file.

## 9. Delivery order and acceptance gates

This RFC is one documentation slice. Implementation starts only after section 10
and the persistence worksheet are confirmed; then use a stack, one concern per PR:

1. **Contract:** versioned Hub frames and Environment-bound administration shapes.
2. **Secure storage capability:** JSON file/directory modes and approved inventory
   entries; test temporary-file permissions independently of Hub behavior.
3. **Hub host:** package/bin, configuration, paths, single-writer lock and records.
4. **Enrollment:** token consumption, credential-authenticated socket handshake
   and revocation endpoints. Prove wrong UUID, replay and lost acknowledgment.
5. **Daemon relationship:** target-local pending/active lifecycle and administration
   RPC, including reconnect authentication against the enrollment fixture.
6. **Schedule admission:** trigger migration, current-target validation and
   external fire interface with run id; no network. Preserve local Run now.
7. **Execution receipts:** pre-effect claim, prompt gate, crash recovery and
   correlation using the Schedule implementation, not another executor.
8. **Connector dispatch:** bounded hello/refresh, create and status recovery;
   independent of Desktop lifetime. Prove wrong-Environment denial.
9. **GitHub ingress:** bounded signature/action/actor checks, unique Schedule
   match, delivery dedupe, deadline and offline rejection.
10. **CLI administration:** explicit target, noninteractive secrets, existing
    quiet/JSON output and exit codes. Update help and teaching skills.
11. **Environment-scoped Trigger UI:** ordinary Schedule/session navigation;
    screenshots and video of local and remote isolation. No badge in this slice.
12. **Write-back only if approved:** separate result/retry design and real GitHub
    proof; do not make dispatch depend on `gh` availability.

Required automated checks use existing package Vitest tests and Turbo typecheck,
not Turbo tests or a fake full GitHub simulator. Focus on public seams:

- Same Project/session ids on A and B cannot cross-route. Enrollment and dispatch
  with A's UUID on B fail before writes/fire. Changing connection URL/token does
  not change Environment identity; removing a remote never redirects to local.
- Concurrent duplicate deliveries/creates produce one fire attempt. Same id with
  different content fails. Drop acknowledgment, restart each process, and inject
  a failure before/after every claim/run/ref/prompt write boundary. Unknown stays
  non-retryable, including after 20 runs, Schedule deletion, and receipt cap.
- No/ambiguous Schedule, wrong repository/relationship, pause racing admission,
  expiry/circuit/cap, busy reused session and missing worktree all fail safely.
  New GitHub work never recreates a missing worktree implicitly.
- Malformed/oversized frames, bad signatures, unauthorized actors, expired/reused
  tokens, duplicate sockets and secret canaries exercise the actual boundaries.
- Backward migration, newer/corrupt refusal, file modes including temps, lock
  contention, revocation failure and disconnected local-only operation are tested.

Runtime proof is separate:

1. Isolated Hub and two daemon homes, A and B, distinct UUIDs. Desktop connects
   both; enroll B only. Drive a signed fixture to a real B Schedule. Verify B's
   Session/run, no writes on A, and correct environment-qualified navigation.
2. Close B's UI tunnel/Desktop: B still receives Hub work. Stop B: Hub records
   offline with no queued fire on restart. Remove B from UI: session links fail
   closed, while A still works. Revoke: old credential cannot reconnect.
3. A real signed GitHub delivery requires a public HTTPS endpoint (Funnel or
   another explicitly approved deployment). Tailnet fixtures prove WSS/routing,
   not GitHub.com ingress. No production exposure changes without consent.

No daily homes, no token logs, no captured secrets in evidence. Follow current
Verify rules: leave `HOME` and the operator's Pi configuration unchanged, do not
point `PI_CODING_AGENT_DIR` at an empty directory, and do not adopt or kill
another run. Public screenshots crop paths, identifiers, credentials, and daemon
records. UI work requires screenshots and video; non-UI work requires safe
receipts/logs and actual target observations. This documentation revision claims
none of these runtime gates.

## 10. Decisions for the Developer

Before implementing, confirm:

1. **Scope:** retain one Environment per Hub for V1, even though Desktop connects
   many. If Hub must route to many immediately, define explicit target ownership
   before implementing routing; do not infer it from duplicate repository names.
2. **Setup and feedback:** accept noninteractive operator-token enrollment instead
   of password/login persistence, Node-only Hub, and dispatch-first without
   automatic write-back or Session badge? These replace proposed, not shipped APIs.
3. **Failure and storage:** approve the worksheet's owners/paths/modes, Schedule
   v2 and restore-only downgrade, fail-closed at-most-once attempt with unknown
   crash outcomes, retained/capped receipts and no power-loss guarantee?

Until confirmed, these remain alternatives under review, not settled ADRs or
approved host writes. The implemented Environment identity and RPC isolation
invariants are not open questions. Neither is the current queued-prompt
observation path, nor the existing shared Pi default-model write.
