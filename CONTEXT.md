# pie

Glossary of project-specific terms. pie integrates the Pi coding agent into the browser; this file names the concepts that recur across the codebase.

## Session Domain

**Project**:
A working directory the user has registered with the server, identified by a server-generated UUID. The single source of the projectId → directory mapping; the directory field is `path`. Sessions always resolve their working directory through a Project, never from a caller-supplied path.
_Avoid_: workspace, repo, cwd (for the Project field)

**SessionRef**:
The composite identity `{ projectId, sessionId }` that every session operation addresses. `sessionId` is a server-generated, globally unique opaque UUID so a bookmarked URL can reverse-resolve its complete ref; clients still use the complete ref for operations, caches, and persisted state.
_Avoid_: bare sessionId as a wire identity or client-state key; harnessAgentId (removed — Pi is implicit)

**Agent session id** (`agentSessionId`):
The Pi-native session identity held in the session's metadata. Internal plumbing for resume/history — never exposed as wire identity. Persisted in `storage/sessions/<projectId>/<sessionId>.json`.
_Avoid_: harnessSessionId (removed — no migration), native id

**Attach**:
A client connecting to a session's live event stream — `session.subscribe` plus the snapshot taken at connect, surfaced to the chat runtime as the synthetic `"attached"` event (whose terminal counterpart is `"closed"`). Reserved for that: nothing else in the session domain attaches. Opening a session page is `session.prepare` (validate the ref, backfill cwd, check whether Pi still knows the native session — starts nothing); getting the client-side `Chat` instance for a ref is `ChatManager.chatFor`.
_Avoid_: attach for the cold pre-flight (its former name) or for taking a Chat instance; resume (`session.prepare` starts nothing — only a prompt does)

**Session metadata**:
The server-owned recovery record for a session: which Project, which Pi agent session id (`agentSessionId`), and whether the session is archived. Distinct from conversation history, which stays in Pi's native storage.

**Workspace path**:
The validated absolute directory handed to Pi when opening or resuming a session; always derived from `Project.path`, never accepted directly from session API callers.
_Avoid_: cwd (in session APIs)

## Server Session Services

The session domain (`packages/server/src/harness/`) has four public roles — Pi only, no registry. One-liner: `PiAgent` knows how to get in, Manager knows who is alive, `PiAgentRuntime` is the live child, Service is the outward face.

**PiAgentSessionService** (`harness/session-service.ts`):
The outward session service the RPC router calls, addressed by SessionRef: generates server sessionIds, persists metadata (private repository), translates SessionRef → `agentSessionId`, validates wire vocabulary (prompt parts), publishes collection events. Holds no live state. Receives the workspace path from the router; never resolves a projectId itself.

**PiAgentSessionManager** (`harness/session-manager.ts`):
The sole owner of live session state: the table of sessions keyed by ref (each `Live` or `Closing`), and the `acquire` a session runs when it decides it needs a runtime. Sole caller of `PiAgent.create`/`resume`. A ref with nothing live reads as idle at cursor 0 rather than failing.

**PiAgent** (`harness/pi/agent.ts`):
Effect Context service: availability check, create/resume, and cold reads. Constructed once in `rpc/runtime.ts` with availability cached for the process lifetime.

**PiAgentRuntime / PiProcess** (`harness/pi/runtime.ts`, `harness/pi/process.ts`):
`PiAgentRuntime` is the live execution resource (prompt/events/close) for one agent session id. `PiProcess` spawns and owns the underlying `pi --mode rpc` child.

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
