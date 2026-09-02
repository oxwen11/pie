# pie Hub

## Status

Proposed.

## Summary

Add a public **Hub** that turns GitHub events into sessions on an enrolled pie
daemon. The daemon stays the only place Pi runs. Hub never sees API keys, never
opens a workspace path, and never shares the daemon's oRPC or UI surface.

V1 is one trigger path and one transport:

- GitHub `issue_comment` containing `@pie`, or an issue labeled `pie`;
- the daemon opens an outbound WebSocket to Hub and receives create/control
  frames;
- Hub execution becomes a normal pie session:
  `session.create({ worktree })` then `session.prompt`;
- write-back uses the machine's existing `gh` login, same adapter as the
  pull-request integration.

Cloudflare Workers, Durable Objects, job queues, Slack, and a workflow YAML
engine are out of V1. They stay compatible later because dispatch is a
transport behind one protocol.

This is informed by Paseo Hub, but it is not a port. pie already has Project,
SessionRef, worktree-on-create, a single-daemon invariant, and Pi as the only
agent. Hub must sit on those seams.

## Goals

1. Receive signed GitHub webhooks on a public HTTPS Hub without exposing the
   pie daemon.
2. Enroll one daemon per Hub organization in V1; route by advertised git
   remotes, not by a caller-supplied path.
3. Start a worktree session and first prompt through the existing session
   service. Pi and model credentials stay on the daemon machine.
4. Keep Hub identity separate from the human CLI login and from the daemon
   bearer token used by the local UI.
5. Fail closed when the daemon is offline (`daemon_not_connected`). V1 does
   not queue.
6. Leave a wire protocol that can later grow a pull transport or a Worker
   ingress without changing `PiAgentSessionService`.

## Non-goals

V1 does not include:

- Cloudflare Workers, Durable Objects, or any edge rewrite of Hub;
- a poll/`claim` transport (the protocol may reserve the methods);
- Slack, Discord, Linear, or generic inbound HTTP automations;
- a `.pie/workflows` YAML engine or multi-step routing;
- GitHub App installation tokens (daemon uses local `gh`);
- cloning a repository the daemon has not registered as a Project;
- exposing `/api/*` oRPC, tickets, or the SPA on the Hub process;
- changing the single-daemon-per-`PIE_DAEMON_DIR` invariant;
- a second agent or harness registry;
- Hub-owned session history or a second event stream;
- automatic PR open (the agent may `gh pr create` if the prompt asks).

## Why this shape fits pie

| Existing piece | Hub uses it as |
| --- | --- |
| `Project.path` | The only directory mapping. Hub sends `owner/repo`; the daemon resolves a registered Project whose remotes match. |
| `SessionRef` | The durable identity after dispatch. Hub's `executionId` is *not* a session id. |
| `session.create` + `worktree` | Isolation from the user's main checkout. Git failure fails the execution with no session record. |
| `session.prompt` | The only way Pi starts. Observing still costs no process until the prompt. |
| `PiAgentSessionManager` | Sole owner of live state. Hub is another caller of the session service, not a second runtime table. |
| `GitHubCliAdapter` | Issue/PR comments and later `gh pr create`. No new GitHub HTTP client in V1. |
| Daemon bearer + tickets | Stay on loopback/UI. Hub traffic never reuses them. |
| `$PIE_HOME` / `$PIE_DAEMON_DIR` | Session metadata and the single-instance lock stay where they are. Hub state lives on the Hub host. |

The current pull-request design (`docs/design/github-pull-request-integration.md`)
explicitly deferred webhooks. Hub is that missing inbound path. It must not
collapse into `PullRequestService`: that module is session-scoped and
cwd-in, query/mutate the current branch's PR. Hub is event-in, session-out.

## Architecture

```text
GitHub webhook (public HTTPS)
        │
        ▼
packages/server/src/hub/serve.ts     pie hub serve
  POST /hooks/github                 verify signature
  HubDispatch                        match trigger, pick enrolled daemon
  HubSocketServer                    one WS per enrolled daemon
        │
        │  outbound from the laptop / build box
        ▼
packages/server/src/hub/connector.ts  lives inside pie serve / daemon
  HubConnector                       enroll + reconnect
        │
        ▼
HubExecutionService
  remote → Project → session.create({ worktree }) → session.prompt
        │
        ├─ sidebar: ordinary session (optional origin badge)
        └─ gh: comment on the triggering issue
```

Two processes, two HTTP apps:

| Process | Command | Listens for | Must not |
| --- | --- | --- | --- |
| Hub | `pie hub serve` | GitHub webhooks, daemon WS, a tiny operator HTTP API | Load UI, oRPC, or `Project.path` |
| Daemon | `pie` / `pie serve` | Local UI + oRPC as today | Bind a public webhook port |

`pie hub serve` is a second composition root next to `http/main.ts`. It does
not call `createRpcRuntime` or `createUIHandler`. Shared code is limited to
Effect platform layers, observability, and Hub protocol schemas.

Do not add a `packages/hub` workspace package in V1. Architecture already
places all runtime in `@getpie/server`. A package split is a later extract.

## Identities

Three secrets, never interchangeable:

1. **CLI login** — human operator of Hub. Stored under `$PIE_HOME/hub/` keyed
   by Hub origin. Used to mint an enrollment token. `pie hub logout` deletes
   this only.
2. **Enrollment token** — one-time, ~10 minutes, `daemons:enroll`. The CLI
   hands it to the local daemon and forgets it.
3. **Relationship credential** — generated by the daemon, persisted locally,
   presented on every Hub WebSocket. Survives CLI logout. Revocation is
   `pie hub disconnect` or Hub-side revoke.

The daemon's existing UI bearer token is a fourth secret and stays off this
path.

Remote Hub origins require HTTPS. Cleartext HTTP is loopback-only
(`localhost`, `127.0.0.1`, `[::1]`), same rule as pie's current Host checks.

## Protocol

Wire types live in `@getpie/contract` as a Hub leaf (no session RPC import
cycle). Frames are tagged. V1 messages:

**Hub → daemon**

- `hub.execution.create.request` — `{ executionId, repository, trigger, prompt, worktree }`
- `hub.execution.control.request` — `{ executionId, action: "interrupt" \| "archive" }`

**Daemon → Hub**

- `hub.hello` — `{ relationshipId, remotes: ["owner/repo", ...] }`
- `hub.execution.create.response` — `{ executionId, ref?: SessionRef, workspace?, error? }`
- `hub.execution.event` — sparse progress (`started`, `idle`, `failed`), not
  the full session event stream
- `hub.execution.control.response` — `{ executionId, action, ok: true }`

`executionId` is Hub-minted and idempotent. A retried create for the same id
returns the existing SessionRef and does not prompt again. The daemon stores
`executionId → SessionRef` under `$PIE_HOME/hub/executions/`.

`prompt` is already-rendered text. Hub templates it from the GitHub payload
(`@pie` body, issue title, number, url). The daemon does not re-parse GitHub
JSON in V1.

`worktree` is `{ base?: string }` and uses the existing create payload. Hub
does not name branches; pie assigns `pie/<key>` as today.

Transient stream frames are not replayed after reconnect. Control and create
are.

## Routing

On hello, the daemon advertises remotes collected from registered Projects
(`git remote get-url` per `Project.path`). Hub indexes `owner/repo →
relationshipId`.

- Unknown repository → Hub comments (or logs) `no enrolled daemon has this
  remote` and does not create an execution.
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

| GitHub event | Match |
| --- | --- |
| `issue_comment` / `pull_request_review_comment` | comment body contains `mention`, sender in `fromUsers` |
| `issues` labeled | added label equals `label` (case-insensitive), actor in `fromUsers` |

Hub reacts 👀 on accept, 🚀 when the daemon acks create, 👍/👎 on terminal
execution status. The agent comment (summary / PR link) is a later step of
the same execution, posted by the daemon via `gh`.

Do not subscribe to `push` or `pull_request.synchronize` in V1.

## Session origin

Add an optional, daemon-owned floor field on session metadata:

```ts
source?: { kind: "hub"; executionId: string }
```

- Written only by `HubExecutionService` at create.
- Never an overlay from Pi.
- List/UI may badge "Hub" and deep-link Activity later.
- Absence means a human-created session. No backfill.

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
  readonly kind: "push" | "pull"
  readonly start: (handler: HubExecutionHandler) => Effect.Effect<void>
}
```

- **push (V1):** outbound WebSocket, Hub `send`s create/control.
- **pull (later):** `GET /executions/claim` on Hub. Needed if a future Worker
  ingress cannot hold sockets, or a proxy kills idle upgrades.
- **Worker + Durable Object:** an alternative *Hub* host implementing the
  same webhook + push protocol. Not a third runtime for Pi.

Capabilities stay explicit: `localFs: true` only on the daemon. A Worker
never implements `HubExecutionService`.

## Package and CLI layout

```text
packages/contract/src/hub.ts          protocol schemas
packages/server/src/hub/
  protocol.ts                         re-export / internals
  connector.ts                        daemon-side WS + reconnect
  execution-service.ts                Project + session.create + prompt
  remotes.ts                          Project.path → owner/repo
  relationship.ts                     persist credential + execution map
  serve.ts                            Hub composition root
  webhook.ts                          GitHub signature + event fold
  dispatch.ts                         match + pick relationship
packages/pie  (CLI)
  pie hub serve
  pie hub login <origin>
  pie hub connect
  pie hub status
  pie hub disconnect
```

`HubConnector` starts only when a relationship file exists. The default
`pie` / `pie serve` path stays Hub-unaware until `connect`.

Hub data on the Hub host (not `$PIE_DAEMON_DIR`):

- embedded PGlite or SQLite under `$PIE_HUB_DATA` (default
  `$XDG_DATA_HOME/pie-hub`) for V1 single-process;
- relationship public ids, advertised remotes, delivery log, operator
  account.

Postgres is a later production option, not a V1 requirement.

## Security

- Verify `X-Hub-Signature-256` before parsing interesting fields.
- Hub process has no FileSystem access to anyone's `Project.path`.
- Connector has no Hub-side permission to list sessions or read history.
- `fromUsers` is validated at Hub start; empty allowlist is a boot error.
- Prompts wrap the GitHub body as untrusted text. Hub does not grant extra
  Pi tools.
- Public Hub + enrolled daemon is equivalent to "this allowlisted GitHub
  user may start a worktree session on that machine." Treat enrollment like
  pairing.

## UI

V1: Hub-created sessions show up in the existing project session list because
they are ordinary sessions. Optional badge from `source.kind === "hub"`.

No Hub dashboard in the SPA for V1. Operator checks `pie hub status` and the
GitHub issue thread. A later Activity view can read Hub's delivery log over
the operator API.

Do not add Hub chrome to the pull-request content panel.

## Slices

Land as a stack. One concern per PR.

1. **contract + glossary** — `packages/contract` Hub schemas; CONTEXT.md
   terms (`Hub`, `Hub execution`, `relationship`, `source`). No runtime.
2. **daemon execution driver** — `HubExecutionService` + remotes +
   `source` persistence. Tests feed a fake create request; no network.
3. **connector** — enroll/hello/reconnect/idempotent create map. Tests use
   an in-process socket fixture.
4. **hub serve + webhook** — signature verify, trigger match, delivery log,
   `daemon_not_connected`. Tests are HTTP fixtures, no Pi.
5. **CLI** — `pie hub login|connect|status|disconnect|serve`.
6. **write-back** — 👀/🚀 reactions and a completion comment via `gh`.
7. **UI badge** — session list origin chip; screenshot on the PR.

Do not mix slice 4 (public HTTP) with slice 2 (session create). The driver
must be callable without Hub so it stays a session-domain test.

## Alternatives rejected

**Webhook on `pie serve`.** Would publish the oRPC/UI process. Host allowlists
and bearer tickets are not a GitHub-facing policy.

**GitHub Actions instead of Hub.** Burns hosted minutes; hosted runners cannot
see the user's disk or local API gateway. Self-hosted Actions is a runner, not
a pie session.

**Paseo Hub as-is.** Speaks a different session model and a multi-provider
agent catalog. pie is Pi-only and already owns worktree/create.

**Worker-first Hub.** Feasible later (DO hibernation for inbound daemon
sockets). It rewrites the Hub host, not the daemon driver. V1 should prove
the driver against a Node Hub.

**Queue when offline.** Changes the product from "in-session now" to "mail
waiting." Add only with an explicit user-visible queued state.

## Open questions

1. One Hub organization vs many users on one `pie hub serve` — V1 assumes
   a single operator account.
2. Whether mention matching is `@pie` only or a configurable string (config
   already allows it; default is `@pie`).
3. Session title floor: first prompt vs `Hub: owner/repo#123`. Prefer the
   existing first-prompt floor plus the origin badge.
