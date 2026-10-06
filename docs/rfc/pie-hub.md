# Pie Hub: a single-deployment event broker for Environments

Status: proposed, not implemented. Rebased against `origin/main` at `91247adf`.
Revision 6 reshapes the proposal around the Developer's direction: Hub is
**deployed once** by **one operator** and **receives events for many
Environments**. It receives, verifies, stores and delivers; what an Environment
does with an event is that consumer's business. Decisions marked **approval
required** are not authorization to implement host writes or to deploy.

## 0. Decisions

Settled by the Developer:

- One Hub deployment per operator; many enrolled Environments (not one).
- Hub's job is uniform ingress and delivery. Consumption is pluggable; the first
  and only V1 consumer is a Pie daemon.
- Hub authority over a daemon is limited to its own conversations; the daemon
  holds the Session mapping; the daemon writes back with local credentials.
- GitHub is the only source adapter in V1.
- Build the connection first; Schedules, Sessions and write-back come later.
- Offline events may be held.

Recommended here, still to confirm: Cloudflare Worker + one Durable Object as the
host after a local prototype (section 8); the hold defaults (section 6); the
enrollment and storage choices (sections 3 and 9).

## 1. Current baseline, not proposed capabilities

Re-verified against `origin/main` at `91247adf`; no daemon, Schedule, relay or
pairing code changed since the previous revision.

| Existing capability                                                                                                                                                                                                                                                         | Consequence for Hub                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A daemon has a persistent UUID in `$PIE_HOME/storage/environment-id` (plain text, 0600). `GET /api/environment` returns only `{id}` and needs the bearer when a token is set                                                                                                | Reuse that identity; never mint a second machine id. There is no version/capability endpoint, so Hub brings its own handshake. `/api/health` is the only anonymous probe  |
| One daemon/writer per `$PIE_HOME`; lifecycle files are under `daemon/` (`daemon.pid` holds the token, 0600)                                                                                                                                                                 | Enrollment belongs to the target daemon home, not Desktop or the CLI's home                                                                                               |
| Installed home is `~/.pie`; checkout home is branch-derived                                                                                                                                                                                                                 | Use `Paths`; neither `NODE_ENV` nor the removed `PIE_DAEMON_DIR` selects daemon identity                                                                                  |
| `EnvironmentRpc.for(environmentId)` binds every call and cache key; local is pinned                                                                                                                                                                                         | Hub administration and session navigation must use the same Environment                                                                                                   |
| Only SSH feeds the Environment feed today. Tailscale publishes a local daemon, LAN is a bind option, relay is a TCP rendezvous, pairing gives a browser a session; remote tokens are not persisted (browser pairing: `localStorage`; server pairing sessions are in memory) | They are access paths, not Hub enrollment or execution authority. Desktop `hub.*` reaches local and SSH Environments; others use CLI `--url` or run the CLI on the target |
| Node daemon hosts a Bun `pie-pi-process` built from the Pi SDK                                                                                                                                                                                                              | Hub starts neither; no dependency on a user-installed `pi` executable                                                                                                     |
| Schedule exposes `runNow(id)`; unexported `fire(schedule, reason)` owns session selection, run records, prompt and settlement. `ScheduleRunReason` is `scheduled\|catch_up\|manual\|missed_recovery`; Schedule has no trigger field; files are v1 envelopes, no migration   | Later phases add a new fire interface and must not require new stored fields or enum values (section 7)                                                                   |
| `claimInFlight` is a process-local set, and a scoped Schedule runtime exists                                                                                                                                                                                                | Extend these protections; durable dedupe is the receipt, not this set                                                                                                     |
| `PiAgentSessionService` has `prompt`, `interrupt`, `archive`, `restoreWorktree`                                                                                                                                                                                             | The later consumer maps conversation actions onto these; Hub never calls them                                                                                             |
| A prompt Pi queued after Pie consumed its finish event is attached and streamed. Creating a Session with an explicit model writes Pi's shared default outside `$PIE_HOME` (`persistDefaultPiModel`)                                                                         | Do not treat that race as a failed admission; that write is not Environment-local and not isolated by a second Pie home                                                   |

Hub packages, contracts, connectors, subscriptions and commands do not exist on
this baseline. Neither `CONTEXT.md` nor this proposal is implementation proof.

## 2. Product boundary

```text
GitHub --signed webhook--> Hub (deployed once, public HTTPS)
operator --bearer--------> Hub        verify -> normalize -> store -> route
                             ^
                             | authenticated outbound WSS, one per Environment
        +--------------------+--------------------+
        |                    |                    |
   Environment A        Environment B        Environment C
   Node daemon          Node daemon          Node daemon
   (consumer)           (consumer)           (consumer)
        ^
        | existing authenticated RPC
        |
   Desktop / web / CLI (independent of Hub)
```

Hub is an event **broker**, not a second daemon, a proxy for daemon traffic, or a
workflow engine. Its stages:

1. **Source adapter** verifies a source's request and normalizes it into an
   **event** (id, source, type, optional conversation key, `receivedAt`,
   `expiresAt`, bounded payload).
2. **Router** finds the Environment whose advertised **subscription** matches.
3. **Delivery** sends the event over that Environment's socket, requires an ack,
   retries, and optionally holds it while the Environment is offline.

Consumers are pluggable in principle; V1 has one, a Pie daemon. Nothing else is
built (no HTTP callback consumer, no polling API, no `tail` command) until there is
a concrete need. The seam is the event envelope plus ack.

One operator owns one deployment and all of its Environments. There is no account
system, tenant isolation, or per-user configuration. A Desktop may still connect to
other Environments that are not enrolled. Multi-tenant hosting is out of scope and
would be a separate design.

| Owner                                                  | Responsibility                                                              | Forbidden                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/hub` (`@getpie/hub`), Cloudflare Worker + DO | Public webhook, enrollment, Environment sockets, event store, routing, hold | Pi, workspace access, daemon RPC proxy, SPA, imports of server/CLI     |
| `packages/server/src/hub/`                             | Target-local relationship, connector, receipts, subscriptions               | Starting Hub, selecting another Environment, exposing a public webhook |
| `packages/pie`                                         | Project Hub administration contract onto CLI                                | Writing relationship files or choosing a focused Desktop Environment   |
| `packages/contract`                                    | Validated Hub frames and daemon administration contract                     | Runtime implementation imports                                         |

Hub depends only on the contract leaf plus Web-platform APIs (section 8).

### Compared with t3code and paseo, not copied

Checked t3code `main` at `9bd1d8009` and paseo `main` at `a7f7405c` (both
2026-10-06). The t3code webhook design is studied in
[docs/research/t3code-webhook-scheduled-tasks.md](../research/t3code-webhook-scheduled-tasks.md).

| Concern       | t3code                                                                                                       | paseo                                                                                                 | Pie decision                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Identity      | Server-owned id, independent of route; client keeps ordered routes, checks the descriptor before credentials | `srv_` id per home; host profile with several connections                                             | Already shipped: Environment UUID + `EnvironmentRpc`; reuse                  |
| Ingress       | `webhook` trigger on a task; token in path, optional HMAC, verified on the daemon, via the tunnel            | Daemon dials Hub with an enrollment token; GitHub/Slack triggers live in a closed service             | paseo's shape; GitHub HMAC verified on Hub                                   |
| Direction     | relay pushes to the environment and infers liveness from status codes                                        | daemon dials out                                                                                      | Daemon dials out; delivery uses explicit ack/nack, not status-code inference |
| Authority     | Per-RPC scopes                                                                                               | `hub.execute`, then ordinary daemon-wide agent RPCs                                                   | Narrow frames; later, only Hub-owned conversations                           |
| Idempotency   | `commandId` from delivery id plus receipts; 48 h id table; 202 then in-memory fork (a crash loses the work)  | Creation key journals the agent id first; unfinished delivery is `outcome_unknown`, never resubmitted | Persist a receipt before any effect; `outcome_unknown` (section 7)           |
| Offline       | 503/504 by default; opt-in relay hold in a Durable Object, 24 h, raw tokenized requests                      | Reconnect with backoff; nothing held; missed schedule runs not replayed                               | Opt-in hold of verified structured events, 24 h, capped (section 6)          |
| Secrets       | Webhook token and secret in plaintext SQLite columns                                                         | 0700/0600 private files                                                                               | Credential hash on Hub; raw credential 0600 on daemon; no token in URLs      |
| Compatibility | Protocol version, capability flags, tolerant decoding                                                        | Optional-only fields, feature flags once, dated `COMPAT` tags                                         | Integer version and optional features in hello                               |

Adopted: bounded reconnect with jitter and a revocation close code (paseo);
event ids that survive restarts (t3code's derived `commandId`); a dedupe record that
outlives the hold TTL and is released only on retryable outcomes; the Durable Object
plus SQLite plus alarm hold with TTL and caps; an opt-in hold that deletes on opt-out.

Not copied: a token in the URL path (GitHub signs deliveries); plaintext secrets;
holding raw requests; daemon-wide authority; a webhook route on daemon HTTP or the
existing relay; a template language or second job store; a docs/code split (keep
ADR 0005 and this RFC aligned with the code).

## 3. Identities, authority, and Environment lifecycle

These identities stay distinct:

- `environmentId`: existing daemon UUID; the execution location, not a hostname,
  URL, credential or proof of ownership.
- `relationshipId`: revocable authority binding this Hub to one Environment. A Hub
  has one relationship per enrolled Environment.
- `eventId`: Hub event identity, derived from the source delivery id so a restart
  reproduces it; never a Session id.
- `SessionRef`: unchanged daemon wire identity `{ projectId, sessionId }`. Outside
  that daemon use `{ environmentId, ref }`, matching the app's
  `EnvironmentSessionRef`. Hub never sees a `SessionRef`.

Enrollment pins `environmentId`. Socket identity comes from the authenticated
relationship; a hello cannot switch it. The daemon compares its own UUID with the
enrollment and delivery targets; the serve composition passes the UUID already
loaded by `loadOrCreateEnvironmentId` into Hub administration and the connector. A
mismatch fails closed.

URL/token rotation on a UI connection does not reenroll the daemon; removing an
Environment from Desktop removes its RPC link, not its Hub relationship.
`pie hub disconnect` stops future Hub delivery, not started work or other access. A
second live socket for a relationship is rejected until the old one closes. An
independently cloned `$PIE_HOME` copies identity and secrets; running both is
unsupported and is never treated as two Environments.

### Administrative access is not Hub access

Browser pairing grants daemon RPC; relay transports daemon traffic. Neither is a
restricted Hub credential: reuse their access paths to administer a target, never
their tokens on the Hub socket. The Hub socket may deliver events, receive acks,
status and (later) conversation state. It may not read Sessions, transcripts, files,
settings, credentials or terminals, or manage its own relationship.

Proposed daemon RPCs: `hub.connect`, `hub.status`, `hub.refresh`, `hub.disconnect`.
Every mutation carries `expectedEnvironmentId` and is checked against the actual
daemon. They require authenticated daemon access; tokenless `pie serve` rejects
them. Responses never expose a credential or enrollment token. CLI uses
`packages/pie/src/node/connect.ts` (`--url` / `PIE_URL` is connect-only); no flag
guesses a URL from an id. Desktop calls `environmentRpc.for(environmentId).hub.*`.

### Enrollment — approval required

An operator bearer supplied to Hub as a secret binding authenticates administration.
It is distinct from the webhook secret and the daemon bearer. No password database,
CLI login file, or `login/logout`.

1. `POST /operator/enrollment-tokens` (operator bearer) with an optional label
   mints a 256-bit token, valid ten minutes, at most ten pending; Hub stores only its
   hash and expiry.
2. On the target, `pie hub connect` takes the Hub origin, `--token-stdin` and an
   optional daemon `--url`, and sends the token through authenticated target RPC. No
   secret in argv, URLs, stdout or logs.
3. The daemon generates a relationship UUID and 256-bit credential, persists a
   **pending** relationship, then calls `POST /enroll` with those, its Environment
   UUID and the token. In one serialized step Hub consumes the token, **pins the
   presented UUID** (the token holder is the operator) and stores the credential
   hash. A UUID already enrolled is a conflict.
4. The daemon authenticates the WSS with the credential; an acknowledged handshake
   promotes pending to active. If the `/enroll` ack was lost, retry authentication
   with the same pending credential, never re-enroll with a new secret. If the token
   expired, report enrollment incomplete and require a fresh token.
5. `hub.status` returns Environment UUID, origin, relationship id,
   pending/active/disconnected/revoked, connectivity, held/last event counts and a
   safe error code.

Origin must be HTTPS (exact loopback HTTP only for isolated development); reject
userinfo, query, fragment, unexpected paths, redirects and TLS failures. WebSocket
auth uses headers, not query parameters. Hello carries an integer protocol version
and optional feature flags; later additions are optional-only and used only if
negotiated. No shipped older peer exists, so no dated shims in V1.

Reconnect uses exponential backoff with jitter capped at 30 seconds. Hub closes a
rejected or revoked relationship with application close code `4403`; the daemon
marks it revoked, deletes the raw credential and stops reconnecting, keeping id,
origin and a safe reason. Any other close reconnects.

Disconnect disables local delivery first and attempts credential-authenticated
revocation; if Hub is unreachable the local record stays disabled and revocation
unconfirmed. The operator can `DELETE /operator/relationships/<id>`; revoke persists
before sockets close. Neither deletes receipts or cancels started work. Re-enrollment
gets a new id. CLI disconnect needs `--expected-environment-id` and `--yes`.

## 4. Events, subscriptions, and routing

### Events

```ts
type HubEvent = {
  version: 1;
  eventId: string;
  source: "operator" | "github";
  type: string; // e.g. "issue_comment.created"
  key?: string; // opaque conversation key, <= 200 chars, e.g. "github:owner/repo#123"
  receivedAt: string; // timezone-aware ISO, set by Hub
  expiresAt: string; // receivedAt + hold TTL, or + 60 s when not held
  payload: unknown; // source-specific, validated, <= 64 KiB serialized
};
```

`operator` events come from `POST /operator/events` and give a source-agnostic way
to test and operate Hub without GitHub. `payload` is validated per `source`/`type`
at Hub and again at the daemon; a receiver rejects unknown sources rather than
guessing.

### Subscriptions

A consumer declares what it wants. The daemon sends its full subscription list in
`hub.hello`, replacing the previous list atomically; Hub caches the last list per
relationship so it can route to (and hold for) an Environment that is offline.

```ts
type HubSubscription = {
  id: string;
  source: "github" | "operator";
  repository?: { host: "github.com"; owner: string; repository: string };
  events?: string[];
  mention?: string;
  label?: string;
  // later phases: scheduleId?, reply?
};
```

Subscriptions live in the daemon's `$PIE_HOME/hub/subscriptions.json`, written by
`hub.subscribe` / `hub.unsubscribe` (with `expectedEnvironmentId`), and name their
`relationshipId`, so a newly enrolled Hub inherits nothing. Hello contains no
Project paths, prompts, credentials or Session lists. Repository identity is
lowercased `{ host, owner, repository }` with one `.git` removed; accept HTTPS,
`git@github.com:` and `ssh://git@github.com/`; reject other hosts, local paths, URL
credentials and malformed segments; no SSH alias or Enterprise resolution.

### Routing

For an event, Hub considers every enrolled relationship's cached subscriptions:

- Exactly one matching relationship and subscription: route to it.
- None: `no_route`. More than one (two Environments, or two subscriptions in one):
  `ambiguous_route`. Neither is delivered or retried; both are terminal receipts.
- Never choose by arrival order, load, "first online", fan-out or failover. Two
  machines handling one repository needs an explicit operator target, which is not
  part of V1.

A stale cache may route legitimately to the wrong Environment or reject a valid
event; the daemon re-validates before any effect (section 7). Hello is resent after
any committed subscription change and on reconnect; a bounded 60-second refresh
discovers external `git remote set-url` changes.

### GitHub adapter

Only `issue_comment.created`, `pull_request_review_comment.created` and
`issues.labeled` are eligible. Verify HMAC-SHA256 over the bounded raw body with
constant-time comparison **before** decoding. Require event/delivery headers, JSON
content type and a non-empty operator-configured `fromUsers` allowlist (logins
compared case-insensitively). A comment matches a literal mention token, not a
regex or a longer handle; a label matches case-insensitively. Subscription values
override Hub defaults `@pie` and `pie`. The normalized payload carries repository,
actor, issue number and URL, title and event body; body is limited to 16,000
characters and title to 256, and oversized context is rejected, not truncated.

HTTP: invalid signature or actor 403; malformed 400; oversized 413 (1 MiB); an
unsupported action 204 with no record. A verified delivery gets 202 only after its
event and routing outcome are durably stored; a duplicate delivery id with the same
payload hash gets 200 with the existing safe receipt; the same id with a different
hash is 409; storage failure is 503. The response never waits for a consumer.

## 5. Wire contract

One socket per relationship. Frames are Effect Schemas in `packages/contract`:

- `hub.hello` (daemon to Hub): protocol version, Environment and relationship ids,
  subscriptions, optional features.
- `hub.event.deliver` (Hub to daemon): a `HubEvent` plus `deliveryAttempt`.
- `hub.event.ack` (daemon to Hub): `{ eventId, status }` with `status` one of
  `accepted | rejected | duplicate`, a stable `code` on rejection, and nothing else.
  Phase 1's handler records a receipt and acks `accepted`.
- `hub.ping`/`hub.pong`: 30-second heartbeat; two missed close the socket.

Validate UUIDs, field lengths and discriminants at both receivers. No raw error
strings, `workspace` or `SessionRef` cross to Hub. Limits: WS frame 64 KiB, hello
64 KiB, 10-second header/body deadlines; five operator-auth or enrollment failures
per minute per source; at most 32 pending unauthenticated upgrades; bounded
concurrent webhook handling with 429 beyond it. Untrusted requests never write
arbitrary ids as paths or log bodies, secrets, argv or unsanitized peer errors.

## 6. Delivery and offline hold

Guarantee: **at-least-once delivery to the daemon, idempotent handling by receipt**.
Hub retries a delivery until acked, expired or the relationship is revoked; the
daemon records a receipt keyed by `(relationshipId, eventId)` before acking, so a
retry of a handled event returns `duplicate`. The same `eventId` with a different
payload hash is `execution_conflict`. Effects, which come later, add the stricter
at-most-once rule of section 7.

**Hold** is per relationship and **off by default** (`hold: true` set by the
operator at enrollment or later):

- Not held: if the Environment is not connected when an event is routed, the event
  is a terminal `daemon_not_connected` receipt. No queue, no replay.
- Held: the event stays `pending` until delivered, `expiresAt` (24 hours after
  receipt) or relationship revocation. Hub stores the **verified, normalized
  event**, never the raw request or any header. On reconnect Hub delivers oldest
  first, per relationship, in order; a conflict or reject ack ends that event.
- Caps: 1,000 events, 50 MiB and 100 per conversation key per relationship; at a cap
  new events are terminal `inbox_full` while already-held events still deliver.
  Turning hold off deletes held events.
- Time: Hub sets `receivedAt` and never trusts a sender timestamp. A later phase's
  consumer may refuse an event older than its own maximum age.
- Retry: backoff with jitter on no ack, capped at 10 minutes between attempts.
- Dedupe: Hub keeps the source delivery id for at least 48 hours, longer than the
  hold TTL, released only when a delivery id is not durably recorded.

A receipt or terminal outcome, not a log line, tells the operator what happened to
an event; `GET /operator/events` lists safe outcomes. Hub stores no model output.

## 7. Later phases: effects in the daemon

These phases add behavior on the consumer and reuse Phase 1's envelope, ack and
receipts unchanged. They need their own approval before implementation.

### Effects and at-most-once admission

Starting a Session is not idempotent. Proposed guarantee: **at most one effect
attempt per admitted event across connection loss and restarts, while receipts are
retained**; in an uncertain crash window prefer `outcome_unknown` over a duplicate
prompt. It does not give exactly-once tools or external writes, power-loss recovery,
or recovery after receipt files are deleted.

On `hub.event.deliver` the daemon: authenticates relationship and Environment,
looks up the receipt **first** (a known event stays deduplicated after expiry or
Schedule deletion); otherwise validates `expiresAt`, subscription, repository and
policy; persists `claimed` (or a rejection) **before** creating a Session or
worktree or submitting a prompt; persists `runId/ref` before the prompt; submits the
prompt once; mirrors the confirmed settlement into the receipt. After a restart a
`claimed` receipt is never re-fired: read the recorded run or report
`outcome_unknown`. A crash after Session creation but before the ref is recorded
leaves an unused Session or worktree for explicit cleanup, never a second fire.
Current settlement waits about 60 seconds; report the stored Schedule result, not
task correctness. Do not inspect Pi transcripts to guess whether tools ran.

### Schedule consumer

Schedule storage does not change. A subscription may carry `scheduleId`; the
Schedule must exist, be enabled and have `spec.kind === "manual"`. A Schedule file
trigger field or `github` run reason would force Schedule v2, a restore-only
downgrade, and may make an older binary reject the file; keeping routing on the
consumer side avoids that. An old binary ignores `hub/`: subscribed Schedules just
stop receiving events. A Hub-fired run records the existing reason `manual` and the
effective prompt in the run snapshot; the receipt holds `eventId -> runId`, and the
UI labels a run Hub-originated by joining it. Local Run now fires the saved prompt
with no event context and has no receipt. Eligibility is derived from current
records at hello and again at admission, never cached as authority.

### Conversations

A **conversation** is an external thread's continuity. The daemon owns
`{ relationshipId, key } -> { scheduleId, SessionRef, state }`; Hub sends the
opaque key (the event's `key`) and never a `SessionRef`. With no conversation, the
daemon fires the Schedule's session policy (start) and records the key before the
prompt; with one, it prompts that Session (continue) with only the new bounded
untrusted context. A running Session is `busy` (decision 5), an archived one
`session_archived`, a missing checkout `session_unavailable`; none starts a new
Session implicitly. Hub keeps one routing fact, `key -> relationshipId`, so
follow-ups reach the Environment that started the thread; it holds no Session
information and losing it only makes the next event start a new thread.

`hub.event.control` with `interrupt | archive | restore` acts on one owned
conversation through `interrupt`, `archive` and `restoreWorktree`, reached only from
operator HTTP in V1. Conversation state events (`running | idle | archived |
unavailable`) carry no transcript and no ref. A conversation cap of 10,000 refuses
new starts while continue, control and status keep working.

### Write-back

The **daemon replies with the host's own `gh`** (ADR 0010: no stored second
credential); Hub holds no GitHub credentials, so offline, unrouted or ambiguous
outcomes are receipts only. Opt-in per subscription (`reply: true`); the target is
derived from the validated event, never a caller URL. After settlement, post one
comment with its own `pending | posted | failed | outcome_unknown | skipped` status,
claimed before the `gh` call and never retried after a timeout. This is a new `gh`
capability (comment create): reuse ADR 0010's argv, timeout and bounded-output
rules and amend that ADR. Security gate: posted text is agent output that injection
could shape, and a comment on a public repository is public, hence opt-in, a size
bound and only the settled assistant message; its source needs confirmation
(decision 6). Delimiters are not a sandbox: enrollment authorizes agent execution
with the Environment's privileges.

### Observation

Schedules and Sessions stay visible in their own Environment through existing
catalog hydration; navigation carries `environmentId`, `projectId`, `sessionId`; an
unavailable Environment is shown as unavailable, never as local. A Session badge is
deferred; origin is learned by joining the receipt, and absence of `source` never
proves a human created a Session.

## 8. Hosting: Cloudflare Worker and one Durable Object

Deployed once, always on, public, no servers to run: a Worker routes
`/webhook/github`, `/enroll`, `/operator/*` and `/daemon` (WebSocket) to **one
SQLite-backed Durable Object**. For one operator with tens of Environments this keeps
event claim, routing and hold in one serialized transaction domain, which replaces
a process lock. `ponytail: single object; split per Environment if throughput
matters` (Cloudflare calls a global singleton a bottleneck at high traffic).

Verified in Cloudflare documentation (2026-10-06): SQLite-backed Durable Objects
are available on the Free and Paid plans, up to 10 GB per object, with point-in-time
recovery; the Hibernation WebSocket API keeps connections while the object is
evicted (up to 32,768 per object, per-connection state via `serializeAttachment`);
`setWebSocketAutoResponse` answers ping/pong without waking it and
`getWebSocketAutoResponseTimestamp` supports missed-heartbeat checks; WebSocket
messages may be up to 32 MiB; alarms run at least once with exponential retry;
output gates hold a response until pending storage writes are persisted. Free-plan
limits are 100,000 rows written and 5 million read per day.

### Open-source precedent (read 2026-10-06)

No project does what Hub does end to end; these are the closest, read from clones.

| Project                                       | Relevance                                                                                                                                                                                                   | Take                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Liplus-Project/github-webhook-mcp` (MIT)     | Closest: GitHub App webhook, per-tenant SQLite DO with the Hibernation WebSocket API, a Node client authenticating with `ws` and an `Authorization` header, HMAC check, retention alarm                     | Worker authenticates, then forwards the original request to the DO (`stub.fetch(request)`), and the DO trusts the Worker; strict HMAC length check          |
| `cloudflare/agents` (MIT)                     | Official DO framework: `acceptWebSocket` with tags, `serializeAttachment`, `routeAgentRequest` with an `onBeforeConnect` hook that can reject or mutate before forwarding, an alarm-driven SQLite job queue | Authenticate and authorize before the DO sees the socket; per-connection identity in attachments; one alarm drives retries                                  |
| `loncoeng/durable-webhook` (MIT, Worker + KV) | HTTP relay with retry and dead letters; no Durable Object despite the name                                                                                                                                  | "Accepting is not delivering"; dedupe key from the delivery id; tiered TTLs; backoff table; replayable dead letters; admin auth checked before any 404      |
| `peter-leonov/webhooks-proxy-tunnel` (MIT)    | Worker + DO tunnel to a local Node client over WebSocket; no hibernation, no persistence                                                                                                                    | A new connection closes the old one with a dedicated code (4101), a precedent for the replaced-socket rule; `timingSafeEqual`; do not copy its token scheme |
| `probot/smee.io`, `NuovarDev/HookHQ`          | Live-fanout baseline (no persistence, no ack); an outbound-webhook SaaS, the wrong direction                                                                                                                | Cite only; HookHQ's backoff and jitter code                                                                                                                 |

Gaps in the closest project that Hub must not inherit: `INSERT OR REPLACE` on a
redelivered event resets its processed flag (use `INSERT OR IGNORE`); delivery is
fire-and-forget over the socket with a later `mark_processed` instead of a per-event
ack; no per-client cursor; the heartbeat is a manual string ping that wakes the
object (none of the six uses `setWebSocketAutoResponse`); the rate limiter is
in-memory per isolate; a retired Durable Object class must be kept in configuration
forever, so name classes with migrations in mind. Failure modes reported by a
webhook-relay author: an unawaited retry killed when the handler returns, a send
failure after the event was already persisted returning 500, a recovery cron that was
commented out for months, and a stale second consumer silently taking events. Hence:
persist before any push, answer after persist regardless of delivery, always arm and
monitor the alarm sweep, and run exactly one consumer.

### Phase 0 prototype result (local `wrangler dev`, 2026-10-06)

A throwaway Worker plus one SQLite Durable Object (kept outside the repository) and
a Node `ws` client exercised the contract's transport. All 14 checks passed, with
these observations:

- **Header auth works.** A Node `ws` client sends `Authorization: Bearer ...` on the
  upgrade; a wrong token gets 401 from the Worker; the Worker forwards the original
  request to the object, which trusts it and calls `acceptWebSocket`.
- **Heartbeat without waking.** `setWebSocketAutoResponse("ping", "pong")` answered
  in about 50 ms and `getWebSocketAutoResponseTimestamp` recorded it, so missed
  heartbeats can be judged from an alarm without per-ping code.
- **Hibernation and wake.** After 20 idle seconds the object was re-initialised (its
  constructor ran again) while the socket stayed open; the next operator event
  reached the socket in 15-18 ms. Keep the constructor cheap, and do not generate
  random values at module scope (workerd rejects it).
- **Persist, push, ack.** Events are inserted with `INSERT OR IGNORE` before the push;
  a duplicate id returned `duplicate: true` and did not reset an acked event; an
  event stays `pending` until acked and `attempts` increments on every redelivery,
  including across test runs (SQLite persisted).
- **Hold.** Events injected with no socket stayed `pending` and were delivered
  oldest first on reconnect; unacked events were redelivered.
- **Replaced socket.** A second connection closed the first with code 4101, but
  `getWebSockets()` still listed the closing socket and an event was first sent to
  it; the fix is to deliver only to `OPEN` sockets not marked replaced (stored in the
  attachment). The old socket took about 10 seconds to finish closing locally.

**Still unverified:** whether WebSocket `send` is held by output gates until the
write is persisted (the acks above prove ordering in our code, not the gate); behavior
and latency on Cloudflare's network rather than local `wrangler dev`; Free-plan
quota behavior under real use. Deployment is a production operation and needs the
operator's explicit consent; this RFC authorizes none.

Node-only and a Worker/DO adapter are not both built: the Worker is the single V1
host. `packages/hub` therefore uses Web APIs and DO storage, not `node:fs` or
`@getpie/effect-json-store`.

## 9. Persistence approval worksheet — not shipped inventory

The [host-write gate](../../.agents/rules/topics/persistence.md) requires Developer
confirmation before formats are chosen. This is a candidate, not an approved plan;
after approval update [host-persistence.md](../host-persistence.md) in each slice.

| Location / owner                                                                 | Data, scope and lifecycle                                                                                                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub DO SQLite `config`                                                           | Non-empty actor allowlist and default mention/label, operator-supplied; no empty seed. Operator bearer and GitHub secret are Worker secrets, not rows |
| Hub `relationships`                                                              | Relationship id, Environment UUID, label, credential hash, hold flag, state, timestamps, last cached subscriptions (no paths, prompts or credentials) |
| Hub `enrollment_tokens`                                                          | Token hash and expiry, at most ten pending; swept by alarm                                                                                            |
| Hub `events`                                                                     | Event id, source delivery id and raw-body SHA-256, normalized event, routing outcome, delivery state, attempts, `expiresAt`; no raw body or headers   |
| Hub `conversation_routes` (later)                                                | Conversation key to relationship id only                                                                                                              |
| Daemon `$PIE_HOME/hub/relationship.json`, target daemon writer only              | Origin, Environment UUID, relationship id, pending/active/disabled/revoked, raw credential and timestamps; credential removed after revocation        |
| Daemon `$PIE_HOME/hub/subscriptions.json`                                        | Subscriptions naming a relationship; no prompt, path or credential                                                                                    |
| Daemon `$PIE_HOME/hub/events/<relationshipId>/<eventId>.json`                    | Fingerprint, admission state, optional run/ref (later), outcome and timestamps; no payload copy                                                       |
| Daemon `$PIE_HOME/hub/conversations/<relationshipId>/<sha256(key)>.json` (later) | Key, scheduleId, SessionRef, state, last event id; capped at 10,000                                                                                   |
| Existing Schedule files                                                          | **No change.** Reason `manual`, effective prompt in the run snapshot; existing 20-run retention and fired counter remain                              |

Candidate rules needing explicit approval:

- Daemon Hub files are owner-only (`0700` directories, `0600` files and temps);
  `writeFileAtomic` supports a mode but the document/collection APIs do not, so
  propagate it before storing credentials; refuse symlinked roots.
- New records use version-1 envelopes, no legacy adoption. Missing enrollment means
  disabled; corrupt or newer daemon records disable Hub delivery without reset and
  never block unrelated local Sessions. Migration failure leaves original bytes.
- Schedule files are not modified, so rollback is safe: an older binary ignores
  `hub/`. A later Schedule field or run reason needs its own v2 migration and
  approval.
- A Schedule run with `provider`/`modelId` persists Pi's shared default outside
  `$PIE_HOME`; do not claim Environment isolation for it, serialize proof that uses
  one, and never guess-restore the previous default.
- Atomic rename covers process failure, not power loss. Hub's DO storage commits
  before its output gate releases a response; daemon JSON does not claim power-loss
  durability. If that is required, decide fsync or a database first.
- No automatic receipt pruning on either side: deleting receipts reopens duplicate
  execution. Cap 100,000 per side; at the cap refuse new admissions but keep duplicate
  and status access. Compaction needs a later design. Deleting the Hub object or a
  `$PIE_HOME` is an explicit operator act that discards dedupe.
- Disconnect and revoke keep receipts and Schedule history and delete neither
  checkouts nor Pi state; revocation and erasure are distinct. Never silently clear a
  corrupt receipt to make a request work.
- Hub logs bounded, redacted structured output to Cloudflare's log sink; the daemon
  reuses `pie.log`. Enrollment tokens are stored only as hashes with expiry. No new
  Desktop or browser store.

## 10. Delivery order and acceptance gates

This RFC is one documentation slice. Implementation starts only after the decisions
it needs and the worksheet are confirmed. Phases land independently.

### Phase 0: prototype (no deploy) — done locally

Result in section 8. Remaining before implementation: a deployed-network check of
output-gate behavior and latency, with the operator's consent.

### Phase 1: connection, events and hold

Contract; secure storage capability; Hub host (Worker, DO, config, schema);
enrollment and revocation; daemon relationship and administration RPC; event
delivery with ack and receipts; `POST /operator/events`; opt-in hold; CLI
administration. Hello carries no subscriptions yet and the daemon has no effect
handler: it logs a safe summary and exposes the last event through `hub.status`.

### Phase 2: GitHub and routing

GitHub adapter and verification, daemon subscriptions, routing with
`no_route`/`ambiguous_route`, delivery receipts end to end. Still no Session starts.

### Phase 3: effects (own approval)

Schedule admission and the at-most-once claim; conversations and control;
Environment-scoped UI with screenshots and video of remote isolation.

### Phase 4: write-back (own approval)

`gh` comment capability, ADR 0010 amendment, independent status, real GitHub proof.

Required automated checks use existing package Vitest tests and Turbo typecheck, not
Turbo tests. Focus on public seams:

- Wrong UUID, replayed or expired enrollment token, lost enroll ack, duplicate
  socket, `4403` revocation, and a second Environment cannot read or ack the first's
  events. Enrollment or delivery with A's UUID on B fails before any write.
- Duplicate source deliveries produce one event; the same id with a different body is
  `409`; a lost ack redelivers and is handled once; restart each side at every write
  boundary. Hold respects TTL, caps, order and opt-out deletion; held events never
  contain raw bodies or headers.
- Routing: zero, one, two matching Environments; two subscriptions in one; stale
  cache; no event is delivered on `no_route` or `ambiguous_route`.
- Malformed or oversized frames and bodies, bad signatures, unauthorized actors,
  rate limits and secret canaries exercise the actual boundaries.
- Phase 3 adds: a conversation key from another relationship, or one that maps to a
  Session a person created, is refused; control and continue never reach outside the
  table; pause racing admission; busy, archived and missing-worktree Sessions.

Runtime proof is separate and per phase. Phase 1: isolated Hub (local `wrangler dev`)
and two daemon homes with distinct UUIDs, both enrolled; inject events to each;
verify receipts, no cross-delivery, hold across a daemon restart, and revocation.
A real signed GitHub delivery needs a public HTTPS endpoint and is a production
exposure requiring consent; tailnet or local fixtures prove WSS and routing, not
GitHub.com ingress. No daily homes, no token logs, no captured secrets in evidence;
follow Verify rules (leave `HOME` and the operator's Pi configuration unchanged, do
not point `PI_CODING_AGENT_DIR` at an empty directory, do not adopt or kill another
run); crop paths, identifiers and credentials from public evidence. UI work needs
screenshots and video. This documentation revision claims none of these gates.

## 11. Decisions for the Developer

Phase 1 needs 1 to 3 only; the rest can wait.

1. **Host:** Cloudflare Worker + one Durable Object, gated on the Phase 0
   prototype? Deployment itself needs separate consent.
2. **Hold defaults:** per-relationship opt-in, 24-hour TTL, the section 6 caps,
   verified normalized events only?
3. **Enrollment and storage:** operator-bearer enrollment with the token holder
   pinning the UUID, no password or login; the section 9 worksheet's owners, modes,
   retained and capped receipts, and no power-loss guarantee on the daemon?
4. **Binding placement (Phase 3):** subscriptions on the daemon with Schedule files
   unchanged (safe rollback, UI joins receipts) rather than a Schedule `trigger`
   field (Schedule v2, restore-only downgrade)?
5. **Busy conversations (Phase 3):** reject a continuation while the Session runs
   (the event is lost with a receipt), or add a bounded per-conversation queue on the
   daemon (more durable state and crash semantics)?
6. **Write-back (Phase 4):** which settled message is posted and how it is read
   without scraping transcripts; opt-in per subscription; whether public repositories
   are allowed at all.
7. **Control surface (Phase 3):** operator-only HTTP (here) or also adapter-emitted
   commands such as a comment asking Pie to stop?

Until confirmed, these remain alternatives under review, not settled ADRs or approved
host writes. The implemented Environment identity and RPC isolation invariants, the
current queued-prompt path, and the existing shared Pi default-model write are not
open questions.
