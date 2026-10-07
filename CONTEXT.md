# pie

Glossary of project-specific terms. pie integrates the Pi coding agent into the browser; this file names the concepts that recur across the codebase.

## Session Domain

**Project**:
A working directory the user has registered with the server, identified by a server-generated UUID. The single source of the projectId → directory mapping; the directory field is `path`. Registration is the trust boundary for Project-local Pi resources: session children approve prompts, skills, and context from that Project. Pie-owned children load and execute Pi's built-in extensions, global extensions, and that Project's extensions. Registering a Project trusts execution of its extension code. The daemon does not load extensions; the model list (`listAvailablePiModels`) asks a short-lived Pie-owned child, so extension-registered providers appear. Sessions always resolve their working directory through a Project, never from a caller-supplied path. A session may start without picking an existing Project: `project.allocateChatProjectDir` creates a folder under the **chat-project root**, registers it with `type: "chat"`, then `session.create` uses that id as usual. That path is local-only. The draft project picker lists every connected Environment's imported projects, split into groups labeled by Environment when more than one has projects. Picking a project addresses that Environment. A linked host still cannot allocate a non-project chat. Chat projects stay off the **Projects** sidebar and picker; their sessions appear under **Recent**.
_Avoid_: workspace, repo, cwd (for the Project field)

**Chat-project root**:
The parent directory where `project.allocateChatProjectDir` mints a new folder and registers it as a Project. Fixed at `~/Pie` (`Paths.chatProjectsDir`) — not under `$PIE_HOME` (`.pie`). Folders are `<YYYY-MM-DD>/Chat-1`, then `Chat-2`, `Chat-3`, … on collision (not the first prompt). `Project.name` is the leaf basename.
_Avoid_: scratch, inbox, workspace root, cwd, `~/Documents`, putting chat folders under `$PIE_HOME`

**SessionRef**:
The composite identity `{ projectId, sessionId }` that every session operation addresses. `sessionId` is a server-generated, globally unique opaque UUID so a bookmarked URL can reverse-resolve its complete ref; clients still use the complete ref for operations, caches, and persisted state.
_Avoid_: bare sessionId as a wire identity or client-state key; harnessAgentId (removed — Pi is implicit)

**Agent session id** (`agentSessionId`):
The Pi-native session identity held in the session's metadata. Internal plumbing for resume/history — never exposed as wire identity. Persisted in `storage/sessions/<projectId>/<sessionId>.json`.
_Avoid_: harnessSessionId (removed — no migration), native id

**Attach**:
A client connecting to a session's live event stream — `session.subscribe` plus the snapshot taken at connect, surfaced to the chat runtime as the synthetic `"attached"` event (whose terminal counterpart is `"closed"`). Reserved for that: nothing else in the session domain attaches. Opening a session page is `session.prepare` (validate the ref, backfill cwd, check whether Pi still knows the native session — starts no Pi process). `prepare` fails with `WORKTREE_MISSING` when the checkout is gone; the session page catches that and redirects to `/session/fallback` for an explicit restore, then back to the session route. Getting the client-side `Chat` instance for a ref is `ChatManager.chatFor`.
_Avoid_: attach for the cold pre-flight (its former name) or for taking a Chat instance; resume (`session.prepare` starts no Pi process — only a prompt does)

**Session metadata**:
The server-owned recovery record for a session: which Project, which Pi agent session id (`agentSessionId`), whether the session is archived, and for a worktree session `worktree: { branch }` plus the checkout `cwd`. Distinct from conversation history, which stays in Pi's native storage.

**Schedule**:
An application-level job stored under `$PIE_HOME/storage/schedules/`. Independent of any live session and of `@getpie/pi-loop`. The server daemon is the clock: on start it marks leftover `running` runs `interrupted`, then sleeps until the next due time (1–60s). When a Schedule is due it snapshots the current prompt, starts or reuses a Session, and settles the run to `succeeded` / `failed`. The session file is an ordinary session record — origin is not stored there. The schedule keeps the session ids it created (`lastSessionId`, `session.sessionId` when bound, `runs[].sessionId`). Specs are `cron` (5-field, optional IANA timezone), `every` (fixed interval), `once` (timezone-aware ISO), or `manual` (run now only). Hub-triggered runs are proposed in `docs/rfc/pie-hub.md`, not implemented Schedule behavior. Optional `expiresAt`, `maxRuns` (pauses with `max_runs` after that many fired runs; `firedCount` is the durable counter, `missed`/`skipped` do not count), `session` (`{ policy: "isolated" }` | `{ policy: "owned", sessionId? }` | `{ policy: "existing", sessionId }`), and a failure circuit after three consecutive settle failures. Create may pass `runNow` to fire immediately; it is not stored. Operator signal is structured `event=schedule.*` lines in `$PIE_HOME/logs/pie.log`; the Schedule page keeps the last 20 runs and refreshes while that route is open. There is no EventBus collection event for schedules in v1.
_Avoid_: loop (session-scoped `/loop` in `@getpie/pi-loop`), routine, cron (as the domain noun — it is one spec kind), automation / automations (the old domain name), outputMode / sessionMode / independent / merged / session.type (session policy is `isolated` | `owned` | `existing`), a second schedule store on Hub. The product and code noun is **Schedule** (sidebar: **Scheduled**).

**Workspace path**:
The validated absolute directory handed to Pi when opening or resuming a session. Persisted on session metadata as `cwd` at `session.create` — `Project.path`, or a git worktree path when create requested `worktree`. Worktree creation runs inside create (not a git RPC) and is never stored as a pending flag. A worktree session stores `worktree: { branch }` so a removed checkout can be restored at the stored `cwd`. When the stored directory is gone, `prepare` fails with `WORKTREE_MISSING` for worktree sessions (session page → `/session/fallback` → explicit `restoreWorktree`) and otherwise creates the directory. `restoreWorktree` prunes stale git state and `git worktree add`s the stored branch at the stored path; it does not re-create on prepare/prompt or require `HEAD` to match. Git failure fails create and leaves no session record. `prepare` backfills `cwd` from the project only when metadata has none; it never overwrites a stored worktree path. Worktree checkouts live under `$PIE_HOME/worktrees/<repo>/<key>/`; callers never supply a raw path on the wire. Pi still opens on the first prompt, in the already-stored cwd.
_Avoid_: cwd (in session APIs)

## Server Session Services

The session domain (`packages/server/src/harness/`) has four public roles — Pi only, no registry. One-liner: `PiAgent` knows how to get in, Manager knows who is alive, `PiAgentRuntime` is the live child, Service is the outward face.

**PiAgentSessionService** (`harness/session-service.ts`):
The outward session service the RPC router calls, addressed by SessionRef: generates server sessionIds, persists metadata (private repository), translates SessionRef → `agentSessionId`, validates wire vocabulary (prompt parts), publishes collection events. Holds no live state. The router maps `projectId → path` at create; when create includes `worktree`, the service materializes the checkout and persists that cwd before returning. The service backfills a missing stored `cwd` via `ProjectService.findById` for records that predate persistence (`prepare` writes it; `{ ref }` fs/git resolve via `workspaceFor` does not).

**PiAgentSessionManager** (`harness/session-manager.ts`):
The sole owner of live session state: the table of sessions keyed by ref (each `Live` or `Closing`), and the `acquire` a session runs when it decides it needs a runtime. Sole caller of `PiAgent.create`/`resume`. A ref with nothing live reads as idle at cursor 0 rather than failing.

**PiAgent** (`harness/pi-port.ts`, implemented in `pi/agent.ts`):
Effect Context service: availability check, create/resume, and cold reads. Constructed once in `runtime.ts` with availability cached for the process lifetime.

**PiAgentRuntime / PiProcess** (`harness/pi-port.ts`, `pi/runtime.ts`, `pi/process.ts`):
`PiAgentRuntime` is the live execution resource (prompt/events/close) for one agent session id. `PiProcess` spawns and owns the underlying pie-owned `pie-pi-process` (`dist/pi-process/pi-process.js`, JSONL over stdio, bun-build). The process hosts one Pi `AgentSession` from `@earendil-works/pi-coding-agent`.

**pie-pi-process**:
Always Bun: `bun <pi-process.js> --mode rpc …`. `@getpie/server#build` emits the JS with `bun build --target bun`. A pnpm patch keeps extension UI components and `pi-tui` on the package barrel / virtualModules, drops InteractiveMode, inlines builtin theme JSON, and no-ops highlight.js. Unpackaged / CLI look up `bun` on PATH. Packaged desktop ships Bun (`extraResources/vendor/bun`) and prepends that directory to PATH; the entry is the `@getpie/server/pi-process` export, rewritten `app.asar` → `app.asar.unpacked` because Bun cannot read asar. Missing Bun fails availability.

**Daemon**:
Source `packages/pie` (`pnpm dev`, verify, and tests) and the published CLI both run under Node. From `packages/pie`, source is `node --experimental-transform-types --disable-warning=ExperimentalWarning --import ../../tools/node/register-ts-hook.mjs src/node/cli.ts`. The hook fills extensions that `moduleResolution: "Bundler"` lets source omit; Node's loader does not read tsconfig. Published CLI is `node dist/cli.js` (shebang `#!/usr/bin/env node`, `process.execPath`). Desktop spawns Electron-as-Node (`Pie Helper` + asar `server.js`, `ELECTRON_RUN_AS_NODE`). The live terminal uses `node-pty`. pie-pi-process is a separate Bun process (PATH `bun` plus the package export).
_Avoid_: spawning the shebang `pi` binary under Bun; using a user-installed `pi` as `pie-pi-process`; a Node spawn path for pie-pi-process; launching source `src/node/cli.ts` with `tsx` or Bun

**Private modules** (no Context tags, never wired directly):
`harness/session.ts` — **PiAgentSession**, one session as this server sees it: seq stamping, phase, buffers, pending requests, and the single-flight lifecycle of the runtime it _optionally_ owns. `harness/session-fold.ts` — the pure state fold. `harness/session-repository.ts` — metadata store over `storage/sessions/`.

## UI Components

**Base component**:
A primitive in `packages/ui/src/components/` (button, dialog, select, …). Most are vendored from the [Coss registry](#coss-registry) and built on Base UI; a couple not carried by coss (`carousel` on embla, `splitter` on Ark UI) are kept locally. Refreshed wholesale from the registry rather than hand-authored.
_Avoid_: shadcn component, primitive

**Composite component**:
A higher-level component assembled from base components, living in `packages/ui/src/ai-elements/` and `packages/ui/src/claude-code/`. Hand-maintained; never sourced from a registry.
_Avoid_: widget, element

**Coss registry**:
The upstream shadcn-style component registry at `coss.com/ui` (the `@coss` namespace in `components.json`). It is the source of truth for base components. It is a rolling "latest" — items carry no version or date, so "the latest version" means whatever the registry serves now.
_Avoid_: coss/ui (repo shorthand)

## Content Panel

The column beside the chat, in `apps/app/src/components/layout/content-panel/`.
_Avoid_: right panel, right sidebar, aux panel — "right" is a position, and the
left one is already the **sidebar**.

**ContentPanel**:
The host: one app-wide instance (`apps/app/src/content-panel.ts`) owning the registry, the per-session tab lists, and every live panel instance. Its zustand store holds only what the UI re-renders on _and_ what survives a reload — everything else lives on the instances. Knows no panel type.
_Avoid_: panel manager, panel store

**Panel type**:
The string a definition registers under (`terminal`, `file`, …). Registration is open: an unregistered type in persisted state is skipped, not dropped.
_Avoid_: panel kind, panel variant

**PanelDefinition**:
What `definePanel` / `definePanelFamily` produce — the type, how to label it, how to parse its persisted payload, optionally how to build its instance, and its view. A **singleton** has no `key` (one panel, id = type); a **family** has one (id = `type:key(payload)`), and that is the _only_ thing that differs between them.
_Avoid_: PanelSpec, panel config, panel registration

**PanelHandle / PanelInstance**:
The handle is what every panel gets: id, the complete `SessionRef`, live `payload`, and `activate` / `close` / `setPayload` / `reopen`. The host keys persisted tabs and live instances by that complete ref — never by a bare sessionId. A definition's `create` returns _extra_ members, which the host prototype-links onto the handle to make the **instance**. Instance state is live and unpersisted (a scrollback, a spinner); it outlives navigation and dies on `close`, never on unmount. Materialized lazily — the tab strip draws a restored tab without one, so reopening ten tabs spawns nothing until each is rendered.
_Avoid_: panel object, panel controller

**Tab strip**:
The host's row of open panels — the only place a tab is drawn. A panel that wants several of something opens several panels rather than growing tabs of its own.
_Avoid_: inner tabs, sub-tabs, splits

## Settings

**Settings**:
Pie-owned user preferences in `$PIE_HOME/settings.json`, namespaced by settings domain (`appearance`, and later domains only when they store a value). Distinct from Pi's agent settings, from `PIE_*` process env, from Desktop host state (window geometry in Electron userData), and from origin-scoped chrome (theme FOUC cache, content-panel, shell layout).
_Avoid_: `{ version, data }` envelope; `ui.theme`; putting window bounds or `PIE_*` in this file; proxying Pi settings; empty domain objects; treating process owners (`ui` / `desktop` / `server`) as JSON root keys; calling this file `config.json`

## Hub Domain (proposed)

These terms describe the [Hub RFC](docs/rfc/pie-hub.md), not shipped capabilities.

**Hub**:
A public event ingress that asks an enrolled Environment to run an existing Schedule. It is neither another Environment nor a transport for general daemon access.
_Avoid_: relay, second daemon, Hub-owned Schedule store, workflow engine

**Relationship**:
Revocable authority between a Hub and a specific Environment. Distinct from the Environment's identity and from a client's permission to access that Environment.
_Avoid_: SSH connection, browser pairing, UI bearer token, using a URL or hostname as the Environment identity

**Hub execution**:
One external dispatch, identified by `executionId`, targeting a Schedule in a specific Environment. Its run and optional SessionRef belong to that Environment. A retry is the same execution, not new work; an uncertain outcome is not permission to repeat its effects.
_Avoid_: executionId as sessionId, bare SessionRef across Environments, exactly-once agent effects

**Schedule trigger**:
The proposed authority and event source allowed to start a Schedule run. GitHub supplies context; the Schedule still owns its prompt, Project and session policy.
_Avoid_: a second job definition, treating a new Hub relationship as automatic authorization for old Schedules

## Environments

**Environment**:
A Pie daemon identified by its persistent UUID, independent of the client or access path. The same daemon reached through SSH, LAN, Tailscale or relay remains one Environment. Local is relative to the client; it is not a wire identity. Client operations and caches are scoped by Environment, then by the daemon's Project or SessionRef. Disconnecting a client's access path does not stop the resident daemon.
_Avoid_: hostname/SSH alias/URL as identity, mutable global current Environment, falling back to local when a remote is unavailable, connection (the token+URL triple is `ServerConnection`)
