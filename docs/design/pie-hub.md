# pie Hub

## Status

Proposed.

## Summary

Add a public **Hub** that turns external events into sessions on an
enrolled pie daemon. The daemon stays the only place Pi runs. Hub never
sees API keys, never opens a workspace path, and never shares the daemon's
oRPC or UI surface.

Hub is a long-running **server**. Starting it is executing the binary
(`pie-hub` / `bun pie-hub` / `npx @getpie/hub`) — no `pie hub serve`, no
fork from the daemon. It is the public place other systems connect
through, not a business line. Do not name this process Routine or Intake.

Sources share one dispatch path (delivery → enrolled daemon → existing
`ScheduleService.fire`). V1 ships GitHub as a **Schedule trigger**, not
as a side door that creates sessions with no Schedule row.

**Schedule already exists on the daemon** (`$PIE_HOME/storage/schedules/`,
`ScheduleService`, sidebar **Scheduled**). Hub does not copy that store,
tick loop, run history, or page. A relationship (`pie hub connect`)
unlocks extra **triggers** on the same Schedule: GitHub mention/label,
and later a Hub-hosted clock. No relationship → only today's local
`cron` / `every` / `once` / `manual`. Slack, if it lands, is another
trigger kind on this process, not a new server.

V1 transport:

- GitHub `issue_comment` containing `@pie`, or an issue labeled `pie`;
- the daemon opens an outbound WebSocket to Hub and receives
  create/control frames;
- Hub matches a Schedule with `trigger.kind === "github"` and the
  daemon `ScheduleService.fire`s it (`reason: "github"`);
- write-back uses the machine's existing `gh` login, same adapter as the
  pull-request integration.

**No YAML orchestration.** There is no `.pie/workflows`, no Hub-side
step graph, no `${{ }}` / partials, no deploy bundle. A job is one
Schedule row and one `ScheduleService.fire`. Later sources (Slack, a
Hub clock) are more `trigger` kinds on that row, not a workflow engine.
Do not open a YAML track in this design; that is a new doc if it ever
happens.

Cloudflare Workers, Durable Objects, job queues, and Slack are out of
V1. They stay compatible later because dispatch is a transport behind
one protocol — that compatibility is not a YAML engine.

This is informed by Paseo Hub's process split (separate public ingress,
daemon enrolls outbound), but it is not a port. pie already has Project,
SessionRef, worktree-on-create, a single-daemon invariant, and Pi as the only
agent. Hub must sit on those seams.

## Goals

1. Receive signed GitHub webhooks on a public HTTPS Hub without exposing
   the pie daemon.
2. Enroll one daemon per Hub organization in V1; route by advertised git
   remotes, not by a caller-supplied path.
3. Fire an existing Schedule (`ScheduleService.fire`). Pi and model
   credentials stay on the daemon machine. No session without a Schedule
   row.
4. Keep Hub identity separate from the human CLI login and from the
   daemon bearer token used by the local UI.
5. Fail closed when the daemon is offline (`daemon_not_connected`). V1 does
   not queue.
6. Leave a wire protocol that can later grow a pull transport, a Worker
   ingress, or another source without changing `PiAgentSessionService`.

## Non-goals

V1 does not include:

- Cloudflare Workers, Durable Objects, or any edge rewrite of Hub;
- a poll/`claim` transport (the protocol may reserve the methods);
- Slack, Discord, Linear, or generic inbound HTTP automations;
- a `.pie/workflows` YAML engine, multi-step routing, or Paseo-style
  deployable workflow bundle (closed — not a later slice of this
  design);
- a second Schedule product on Hub (do not copy
  `$PIE_HOME/storage/schedules/` or the daemon tick loop);
- a named Routine product (if that lands, it is a source on Hub, not a
  second public process);
- GitHub App installation tokens (daemon uses local `gh`);
- cloning a repository the daemon has not registered as a Project;
- exposing `/api/*` oRPC, tickets, or the SPA on the Hub process;
- changing the single-daemon-per-`PIE_DAEMON_DIR` invariant;
- a second agent or harness registry;
- Hub-owned session history or a second event stream;
- automatic PR open (the agent may `gh pr create` if the prompt asks).

## Why this shape fits pie

| Existing piece                  | Hub uses it as                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Project.path`                  | The only directory mapping. Hub sends `owner/repo`; the daemon resolves a registered Project whose remotes match. |
| `SessionRef`                    | The durable identity after dispatch. Hub's `executionId` is _not_ a session id.                                   |
| `session.create` + `worktree`   | Isolation from the user's main checkout. Git failure fails the execution with no session record.                  |
| `session.prompt`                | The only way Pi starts. Observing still costs no process until the prompt.                                        |
| `PiAgentSessionManager`         | Sole owner of live state. Hub is another caller of the session service, not a second runtime table.               |
| `GitHubCliAdapter`              | Issue/PR comments and later `gh pr create`. No new GitHub HTTP client in V1.                                      |
| `ScheduleService`               | The only fire path. Hub sends `scheduleId` (+ optional GitHub context). Daemon tick skips non-`local` triggers.   |
| Daemon bearer + tickets         | Stay on loopback/UI. Hub traffic never reuses them.                                                               |
| `$PIE_HOME` / `$PIE_DAEMON_DIR` | Session metadata and the single-instance lock stay where they are. Hub state lives on the Hub host.               |

The current pull-request design (`docs/design/github-pull-request-integration.md`)
explicitly deferred webhooks. Hub is that missing inbound path. It must
not collapse into `PullRequestService`: that module is session-scoped and
cwd-in, query/mutate the current branch's PR. Hub is event-in, session-out.

## Architecture

```text
GitHub webhook (public HTTPS)     later: Slack, Routine, …
        │
        ▼
packages/hub                      @getpie/hub, bin pie-hub
  POST /hooks/github                 verify signature
  HubRouter                       match trigger, pick enrolled daemon
  HubSocketServer                 one WS per enrolled daemon
        │
        │  outbound from the laptop / build box
        ▼
packages/server/src/hub/connector.ts  lives inside pie serve / daemon
  HubConnector                    enroll + reconnect + re-hello
        │
        ▼
  lookup Schedule by scheduleId → ScheduleService.fire
        │
        ├─ sidebar: ordinary session (optional origin badge)
        └─ gh: comment on the triggering issue
```

Two processes, two packages, two CLIs:

| Process | Package                            | Command                       | Listens for                                            | Must not                                                                   |
| ------- | ---------------------------------- | ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Hub     | `@getpie/hub`                      | `pie-hub` / `npx @getpie/hub` | External webhooks, daemon WS, a tiny operator HTTP API | Import `@getpie/server` or `@getpie/cli`; load UI, oRPC, or `Project.path` |
| Daemon  | `@getpie/server` via `@getpie/cli` | `pie` / `pie serve`           | Local UI + oRPC as today                               | Bind a public webhook port; start Hub                                      |

`@getpie/server` is the daemon runtime ("all runtime" in architecture.md means
Pi, oRPC, UI, and the single-daemon lock — not every HTTP process we ever
ship). Hub is a different product: public ingress, no workspace, no Pi.
Shipping it as a second composition root inside `@getpie/server` or as
`pie hub serve` would couple two install surfaces and make a VPS Hub
pull in the daemon, Pi, and local UI stack.

Shared code is `@getpie/contract` Hub schemas only. The Hub package
may use Effect platform layers of its own. It must not import harness,
Project, `http/main.ts`, or the CLI.

## Identities

Three secrets, never interchangeable:

1. **CLI login** — human operator of Hub. Stored under
   `$PIE_HOME/hub/` keyed by Hub origin. Used to mint an enrollment
   token. `pie hub logout` deletes this only. This login lives on the
   **daemon** CLI because it enrolls the local machine; it is not a
   `pie-hub` command.
2. **Enrollment token** — one-time, ~10 minutes, `daemons:enroll`. The pie
   CLI hands it to the local daemon and forgets it.
3. **Relationship credential** — generated by the daemon, persisted locally,
   presented on every Hub WebSocket. Survives CLI logout. Revocation is
   `pie hub disconnect` or Hub-side revoke.

The daemon's existing UI bearer token is a fourth secret and stays off this
path.

Remote Hub origins require HTTPS. Cleartext HTTP is loopback-only
(`localhost`, `127.0.0.1`, `[::1]`), same rule as pie's current Host checks.

## Protocol

Wire types live in `@getpie/contract` as a Hub leaf (no session RPC
import cycle). Frames are tagged. V1 messages:

**Hub → daemon**

- `hub.execution.create.request` — `{ executionId, scheduleId, context? }`
  (`context` is untrusted GitHub text appended to the Schedule prompt;
  Hub does not replace the prompt)
- `hub.execution.control.request` — `{ executionId, action: "interrupt" \| "archive" }`

**Daemon → Hub**

- `hub.hello` — `{ relationshipId, remotes, schedules: [{ id, remotes, trigger }] }`
  Full snapshot for this relationship. Only **enabled** Hub-facing
  rows (`github`, later `hub` / `slack`). Each hello **replaces**
  Hub's in-memory ad table for that socket. `trigger` is the row's
  trigger object (including optional mention/label), not a stripped
  `kind`.
- `hub.execution.create.response` — `{ executionId, ref?: SessionRef, workspace?, error? }`
- `hub.execution.event` — sparse progress (`started`, `idle`, `failed`),
  not the full session event stream
- `hub.execution.control.response` — `{ executionId, action, ok: true }`

`executionId` is Hub-minted and idempotent. A retried create for the same
id returns the existing SessionRef and does not prompt again. The daemon
stores `executionId → SessionRef` under `$PIE_HOME/hub/executions/`.

The Schedule row owns `prompt`, `worktree`, and session policy. Hub
templates `context` from the GitHub payload (`@pie` body, issue title,
number, url). The daemon does not re-parse GitHub JSON in V1.

`trigger` names the source (`github` in V1). Later sources add a variant
here; they do not mint a new `source.kind` or a new process.

Transient stream frames are not replayed after reconnect. Control and create
are.

**Re-advertise.** `hub.hello` is not once-at-connect. The daemon sends
the same frame again whenever the snapshot would change:

- WebSocket connect and reconnect;
- create / update / delete of a row that **is or was** Hub-facing
  (including switching `trigger` to or from `github`);
- pause / resume / `maxRuns` pause of a Hub-facing row (paused rows
  drop out of `schedules[]`);
- registered Project remotes change (new `origin` / fetch URL).

A local-only Schedule (`trigger` absent or `local`) does not hello.
No delta frame, no `hub.schedule.create` on Hub — Hub still does not
store the job. If the socket is down, do not queue hellos; the next
connect sends the current snapshot.

`HubConnector.advertise()` is the only writer of hello. Schedule
mutations call it after the local row hits disk. Do not have Hub poll
the daemon for schedules.

## Routing

On hello, the daemon advertises remotes collected from registered Projects
(`git remote get-url` per `Project.path`). Hub indexes `owner/repo →
relationshipId`.

- Unknown repository → Hub comments (or logs) `no enrolled daemon has
this remote` and does not create an execution.
- Two daemons advertise the same remote → V1 rejects the second hello for
  that remote. Multi-daemon fan-out is a later slice.
- Offline relationship → `daemon_not_connected`. The delivery is recorded;
  nothing is queued.

Project resolution on the daemon: first Project whose origin or fetch URL
normalizes to `owner/repo` (HTTPS and `git@host:owner/repo.git` both match).
No match → create response error, no session.

## Triggers (V1)

Configured on the Hub host, not in the target repository:

```json
{
  "fromUsers": ["alice"],
  "mention": "@pie",
  "label": "pie"
}
```

`fromUsers` is required and non-empty. Events:

| GitHub event                                    | Match                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `issue_comment` / `pull_request_review_comment` | comment body contains `mention`, sender in `fromUsers`              |
| `issues` labeled                                | added label equals `label` (case-insensitive), actor in `fromUsers` |

Hub reacts 👀 on accept, 🚀 when the daemon acks create, 👍/👎 on
terminal execution status. The agent comment (summary / PR link) is a later
step of the same execution, posted by the daemon via `gh`.

Do not subscribe to `push` or `pull_request.synchronize` in V1.

## Schedule + Trigger

A Schedule is the job: name, prompt, project, session policy, worktree,
run history. **Trigger** is who may start a run. One trigger per
Schedule. The field is optional; absent means `{ kind: "local" }` — no
migration of existing rows.

```ts
trigger?:
  | { kind: "local" } // default — daemon ticks `spec`
  | {
      kind: "github"
      mention?: string // else Hub `config.mention`
      label?: string   // else Hub `config.label`
    }
  | { kind: "hub" } // later — Hub ticks `spec`; daemon tick skips
```

`spec` stays `cron` | `every` | `once` | `manual`.

| Trigger           | Needs Hub    | Who is the clock | `spec`                        |
| ----------------- | ------------ | ---------------- | ----------------------------- |
| `local` (default) | no           | daemon           | cron / every / once / manual  |
| `github`          | relationship | GitHub webhook   | `manual` (daemon never ticks) |
| `hub` (later)     | relationship | Hub process      | cron / every / once           |

Scheduled UI: Trigger is a picker. `github` and `hub` are disabled
until `pie hub status` shows a relationship. Creating a Hub trigger
without a relationship is a contract error (`InvalidSchedule`).

**GitHub match (V1).** Hub verifies the signature, then matches against
the **latest hello** for the enrolled socket (remotes + Hub-facing
rows, including per-schedule mention/label). Each match is
`hub.execution.create.request` with that `scheduleId`, then the daemon
`ScheduleService.fire`s (`reason: "github"`). A row created after
connect is invisible until the next hello. No match → delivery
`no_schedule`, Hub comments that, **no ad-hoc session**. Pause,
circuit, and `maxRuns` still apply (paused rows are absent from hello).

**Hub clock (later).** On hello the daemon advertises enabled
`trigger.kind === "hub"` rows (id + spec). Hub ticks those and sends
`hub.execution.create` with `scheduleId` only. Daemon `runNow` /
`fire(reason: "hub")`. Hub does not store the prompt.

**Local.** Unchanged. Daemon `runScheduleLoop` skips any row whose
trigger is not `local`.

Do not put cron+prompt on `~/.pie-hub`. Do not write Schedule origin
onto the session file (runs stay on the schedule). Add `github` and
`hub` to `ScheduleRunReason` when those triggers land.

## Session origin

Add an optional, daemon-owned floor field on session metadata:

```ts
source?: { kind: "hub"; executionId: string }
```

- Written only by `HubExecutionService` at create.
- Never an overlay from Pi.
- List/UI may badge "Hub" and deep-link Activity later.
- Absence means a human-created session. No backfill.
- Do not encode the source channel (`github`, later `schedule` /
  `slack`) on `kind`. That belongs on the create frame's `trigger`.
- Do not write Schedule origin onto the session file. Schedule already
  tracks session ids on the schedule record (`lastSessionId`, `runs[]`).
  Hub uses `source` only for Hub-created sessions.

Do not put GitHub issue numbers on the session record in V1. The prompt and
the `gh` comment carry that context. `pullRequestRefs` stays the
session-scoped PR panel's concern.

## Write-back

V1 posts with the daemon's `GitHubCliAdapter` / `gh` (same auth as the PR
panel). Hub does not mint a GitHub token.

If `gh` is missing or logged out, the session still runs; Hub is told
`writeback_failed`. The user can open the session in the pie UI.

A GitHub App installation token on the create frame is a later slice and
must not replace local `gh` until the PR integration has a second consumer
for a shared executor (already deferred there).

## Transports after V1

The connector should be a small interface so the second transport does not
fork execution:

```ts
interface HubTransport {
  readonly kind: "push" | "pull";
  readonly start: (handler: HubExecutionHandler) => Effect.Effect<void>;
}
```

- **push (V1):** outbound WebSocket, Hub `send`s create/control.
- **pull (later):** `GET /executions/claim` on Hub. Needed if a future
  Worker ingress cannot hold sockets, or a proxy kills idle upgrades.
- **Worker + Durable Object:** an alternative _Hub_ host implementing
  the same webhook + push protocol. Not a third runtime for Pi.

Capabilities stay explicit: `localFs: true` only on the daemon. A Worker
never implements `HubExecutionService`.

## Package and CLI layout

Hub is its own published package and its own CLI. The pie CLI never
starts Hub.

```text
packages/contract/src/hub.ts       protocol schemas (shared leaf)

packages/hub                       @getpie/hub, bin pie-hub
  src/main.ts                         composition root: Bun or Node platform
  src/webhook.ts                      GitHub signature + event fold
  src/router.ts                       match + pick relationship
  src/socket.ts                       inbound daemon WS
  src/store.ts                        JSON documents under ~/.pie-hub

packages/server/src/hub/           daemon-side only
  connector.ts                        outbound WS + reconnect
  execution-service.ts                Project + session.create + prompt
  remotes.ts                          Project.path → owner/repo
  relationship.ts                     persist credential + execution map

packages/pie                          @getpie/cli, bin pie
  pie hub login <origin>           mint enrollment token
  pie hub connect                  hand token to local daemon
  pie hub status
  pie hub disconnect
  (no pie hub serve)
```

Hub is the server process. Foreground, blocking, one listen port:

```bash
pie-hub
# or
npx @getpie/hub
# dedicated host:
bun pie-hub
```

Default bind is `:3000`. Data dir is `$PIE_HUB_HOME`, else `~/.pie-hub`
(`~/.pie-hub-dev` when `NODE_ENV=development`, same split as `~/.pie` /
`~/.pie-dev`). Not `$PIE_HOME/hub/` — that directory is daemon enrollment
(`pie hub connect`). Docker / Fly later wrap this same binary; there is
still no `pie hub serve`.

`HubConnector` starts only when a relationship file exists. The default
`pie` / `pie serve` path stays Hub-unaware until `connect`. Those
`pie hub *` commands configure the **daemon**. They must not depend on
`@getpie/hub`.

When `packages/hub` lands, architecture.md gains one row:

| `packages/hub` | `@getpie/hub` (bin `pie-hub`) | Public Hub process. Depends on `@getpie/contract` only. Must not import `@getpie/server` or `@getpie/cli`. |

## Storage

Two homes, two writers. Files use `@getpie/effect-json-store` envelopes
`{ version, data }` (current schema is version 1). Shapes below are `data`.

### Hub host (`$PIE_HUB_HOME`, default `~/.pie-hub`)

Documents (`makeJsonDocument`) and one collection (`makeJsonCollection`).
Webhook secret and bind address stay in the environment
(`PIE_HUB_WEBHOOK_SECRET`, `PIE_HUB_PORT`).

**`config.json`** — boot document. Empty `fromUsers` is a boot error.

```ts
{
  fromUsers: string[] // GitHub logins; min 1
  mention: string     // default "@pie"
  label: string       // default "pie"
}
```

**`operator.json`** — single operator. Password verifier only; no raw
secret.

```ts
{
  id: string;
  login: string;
  passwordHash: string;
  createdAt: string; // ISO
}
```

**`relationships.json`** — enrolled daemons. V1 length ≤ 1. Store a hash
of the relationship credential, never the raw secret.

```ts
{
  items: Array<{
    id: string;
    credentialHash: string;
    remotes: string[]; // normalized "owner/repo"
    createdAt: string;
    lastHelloAt?: string;
  }>;
}
```

**`deliveries/<deliveryId>.json`** — one file per Hub dispatch
(GitHub V1; later a Schedule pointer or Slack). This _is_ the Hub
execution log. Not a session event stream. Not
`$PIE_HOME/storage/schedules/`.

```ts
{
  id: string
  executionId?: string
  relationshipId?: string
  scheduleId?: string // later: daemon Schedule this delivery fired
  repository: string // "owner/repo"
  trigger:
    | {
        kind: "github"
        event: "issue_comment" | "pull_request_review_comment" | "issues"
        actor: string
        issueNumber: number
        url: string
      }
    | { kind: "schedule"; scheduleId: string }
  status:
    | "accepted"
    | "daemon_not_connected"
    | "create_failed"
    | "started"
    | "idle"
    | "failed"
  error?: string
  createdAt: string
  updatedAt: string
}
```

Enrollment tokens (~10 minutes) live in memory only. Restart forgets
unused tokens; mint again with `pie hub login`.

### Daemon (`$PIE_HOME/hub/`)

Written by `pie hub connect` / `HubConnector`. Hub process never reads
this tree.

**`login.json`** — operator session keyed by Hub origin. `pie hub logout`
deletes this file only.

```ts
{
  origin: string; // "https://hub.example"
  login: string;
  createdAt: string;
}
```

**`relationship.json`** — long-lived pairing. Survives logout.

```ts
{
  origin: string;
  relationshipId: string;
  credential: string; // raw; 0600
  createdAt: string;
}
```

**`executions/<executionId>.json`** — idempotency map.

```ts
{
  executionId: string;
  ref: {
    projectId: string;
    sessionId: string;
  }
  createdAt: string;
}
```

No SQL in V1. PGlite, `node:sqlite`, and Postgres are a later extract if
the log or multi-operator store outgrows files.

## Runtime (Hub process)

Hub is Effect-native and platform-agnostic in domain code: `FileSystem`,
`HttpServer`, `Crypto` ride the `R` channel. The composition root
(`packages/hub/src/main.ts`) is the only place a platform layer is
provided.

Dedicated Hub hosts may bind **Bun** (`@effect/platform-bun`). The same
source must still run on Node (`@effect/platform-node`) so
`npx @getpie/hub` works. Do not import `bun:*` or `node:fs` in webhook,
router, or store modules.

- Effect 4.x RC, same catalog pin as the rest of the repo.
- JSON I/O through `@getpie/effect-json-store` (already `FileSystem`-only).
- Daemon WebSocket upgrade stays at the composition root (same exemption
  `http/server.ts` takes on Node). Bun's upgrade is wired there, not in
  `HubRouter`.
- Published bin is ESM. Deploy with `bun` or `node` against that artifact.

## Security

- Verify GitHub's `X-Hub-Signature-256` before parsing interesting fields.
  That header name is GitHub's; it is not this product's name.
- Hub process has no FileSystem access to anyone's `Project.path`.
- Connector has no Hub-side permission to list sessions or read history.
- `fromUsers` is validated at Hub start; empty allowlist is a boot
  error.
- Prompts wrap the GitHub body as untrusted text. Hub does not grant
  extra Pi tools.
- Public Hub + enrolled daemon is equivalent to "this allowlisted
  GitHub user may start a worktree session on that machine." Treat
  enrollment like pairing.

## UI

V1: Hub-created sessions show up in the existing project session list
because they are ordinary sessions. Optional badge from
`source.kind === "hub"`.

No Hub dashboard in the SPA for V1. Operator checks `pie hub status`
(daemon enrollment) plus Hub process logs / the GitHub issue thread. A
later Activity view can read Hub's delivery log over the operator API.

Do not add Hub chrome to the pull-request content panel.

## Slices

Land as a stack. One concern per PR.

1. **contract + glossary** — `@getpie/contract` Hub wire frames
   (`hello`, create/control, delivery trigger union) and optional
   Schedule `trigger` (`local` | `github` | later `hub`). CONTEXT.md
   terms already drafted. No runtime, no package yet.
2. **Schedule trigger on the daemon** — persist `trigger`, skip
   non-`local` in `runScheduleLoop`, `InvalidSchedule` if `github`
   without a relationship, `fire(reason: "github")`. No network.
3. **create → fire** — given a fake `hub.execution.create.request`,
   resolve `scheduleId`, `ScheduleService.fire`, write
   `executionId → SessionRef` and optional session `source`. No Hub
   process, no `@getpie/hub` import.
4. **connector** — enroll, hello snapshot, re-advertise on Hub-facing
   Schedule mutations, reconnect, idempotent create map. In-process
   socket fixture.
5. **`@getpie/hub` + webhook** — new workspace package, `pie-hub`
   bin, signature verify, match latest hello, delivery log,
   `daemon_not_connected`. HTTP fixtures only. Do not add a Hub-side
   schedule collection.
6. **daemon CLI enroll** — `pie hub login|connect|status|disconnect`
   only. No `serve` subcommand.
7. **write-back** — 👀/🚀 reactions and a completion comment via `gh`.
8. **UI** — Scheduled Trigger picker (Hub kinds disabled until
   relationship); session list origin chip. Screenshot on the PR.

Do not mix slice 5 (public Hub package) with slice 3 (fire). The driver
must be callable without `@getpie/hub`.

## Verification

Two planes. Do not treat a green unit test as a live Hub, and do not
treat Tailscale as GitHub.

**A — repo (every slice, no extra machine)**

`turbo` tests + typecheck on the slice's package. Connector/webhook
use in-process sockets and signed HTTP fixtures (`X-Hub-Signature-256`).
UI slices use `pnpm exec pie-verify web` (isolated `$PIE_HOME`, not
`~/.pie`). These never talk to the Tailscale box.

**B — Tailscale lab (from slice 4 up)**

GitHub's servers are not on the tailnet. Tailscale proves
**daemon ↔ Hub** only.

```text
your laptop (daemon)          lab box (Hub)
  pie serve                     pie-hub
  $PIE_HOME isolated            $PIE_HUB_HOME isolated
        │
        │  outbound WSS
        ▼
  https://<hub>.<tailnet>.ts.net   ← tailscale cert
                                        ▲
              signed curl (not github.com)
```

- Hub origin is the MagicDNS HTTPS name. Cleartext `http://100.x` is
  still rejected (remote origins require HTTPS). Issue
  `tailscale cert` on the Hub box.
- Isolated homes: lab Hub uses `$PIE_HUB_HOME` under `/tmp` or a
  dedicated dir, never the operator's real `~/.pie-hub`. Lab daemon
  uses a throwaway `$PIE_HOME`, never `~/.pie`.
- `fromUsers` is a GitHub login we control. Webhook secret is lab-only.
- Same-box Hub+daemon is allowed for the first connector proof. Two
  boxes (laptop daemon → lab Hub) is the real enroll proof.

**Pass (Tailscale, no GitHub):**

1. `pie hub connect` from the daemon machine to the MagicDNS origin;
   `pie hub status` shows a relationship.
2. Create a GitHub-trigger Schedule after connect → next hello lists
   that id (Hub delivery / Hub log).
3. POST a **fixture** `issue_comment` with a valid signature and an
   allowlisted actor to `https://<hub>/hooks/github` from another
   tailnet node → daemon `fire`s, session appears. Wrong signature /
   unknown actor / no matching schedule / daemon WS down → no session,
   delivery status is the matching error (`no_schedule` /
   `daemon_not_connected`).
4. Pause the Schedule → hello drops it → same fixture → `no_schedule`.

**C — GitHub.com (one live gate, after B is green)**

`github.com` cannot POST to `100.x` or MagicDNS. Need **one** of:

- Tailscale Funnel on the Hub box (public HTTPS → same `pie-hub`);
- or a public URL you already terminate onto that process.

Then: real comment `@pie` / label `pie` on a throwaway repo whose
`origin` the lab daemon has as a Project. Pass = Hub 👀/🚀, daemon
session, `gh` comment from the daemon machine. Skip C if Funnel (or
equivalent) is off; write that on the PR — B is still the merge bar
for dispatch.

Do not verify Hub by opening the pie SPA on the Hub process. Do not
point lab enroll at the user's daily daemon (`PIE_PORT=4000` / `~/.pie`).

## Alternatives rejected

**Webhook on `pie serve`.** Would publish the oRPC/UI process. Host
allowlists and bearer tickets are not a GitHub-facing policy.

**Hub as `pie hub serve` inside `@getpie/server`.** Couples the
public ingress to the daemon install. A VPS Hub would pull Pi, oRPC, and
the UI stack; the pie CLI would grow a second product. Architecture's "all
runtime in server" names the daemon, not every process. Same ops split as
Paseo (separate package + CLI to start, pie CLI only to enroll) — not the
same name or session model.

**Calling it Routine.** Names one future business as the ingress. A Routine
product, if it exists, is a source on Hub.

**Calling it Intake.** Jargon.

**Calling it Link.** Too generic (URL, git, HTML) and reads as a verb.

**GitHub Actions instead of Hub.** Burns hosted minutes; hosted runners
cannot see the user's disk or local API gateway. Self-hosted Actions is a
runner, not a pie session.

**A `.pie/workflows` YAML engine.** Paseo's Hub jobs are deployable
multi-step files. pie already has Schedule; GitHub is a trigger on
that row. YAML would be a second job product (Hub-owned config,
team GitOps, step graphs). Closed. Slack or finer GitHub events add
a `trigger` kind, not a workflow file.

**Paseo Hub as-is.** Speaks a different session model and a multi-provider
agent catalog. pie is Pi-only and already owns worktree/create.

**Worker-first Hub.** Feasible later (DO hibernation for inbound daemon
sockets). It rewrites the Hub host, not the daemon driver. V1 should
prove the driver against a Node Hub.

**Queue when offline.** Changes the product from "in-session now" to "mail
waiting." Add only with an explicit user-visible queued state.

**A second Schedule store on Hub.** Schedule is already
`$PIE_HOME/storage/schedules/` plus `ScheduleService`. Hub GitHub reuses
that session fire path. Remote-only triage is a later Hub tick that
calls `runNow` by id, not a fork of cron/runs/UI.

**PGlite or SQLite for V1 Hub data.** The store is a handful of records.
JSON matches the daemon (`projects.json`, session files) and needs no
new runtime. Revisit SQL if deliveries or multi-operator query become
the product.

**XDG (`~/.local/share/pie-hub`).** Correct on Linux desktops; pie
already uses a home dotdir (`~/.pie`). A second convention is harder to
find.

**`~/.piehub` (no hyphen).** Reads as a different product name. The
process binary is `pie-hub`; the data dir matches that.

**`$PIE_HOME/hub` for the Hub process.** Already claimed by
`pie hub connect` on the daemon machine.

## Open questions

1. One Hub organization vs many users on one `pie-hub` process — V1
   is a single operator (`operator.json`). Multi-tenant is Hosted,
   not this stack.
2. Lab Hub MagicDNS hostname, and whether Tailscale Funnel (or another
   public URL) is available for the GitHub.com gate.

Mention string and session title are closed: `config.mention` defaults
to `@pie` (per-schedule override on `trigger`); session title stays the
existing first-prompt floor plus an origin badge.
