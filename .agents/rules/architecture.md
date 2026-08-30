# Package layout and boundaries

`contract ← server ← cli|desktop` and `contract ← client ← app ← desktop`.

| dir                 | name                      | role                                                                                                           |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/contract` | `@getpie/contract`        | oRPC contract + Effect `Schema` domain types — the shared wire vocabulary. Leaf; nothing may point back at it. |
| `packages/server`   | `@getpie/server`          | All runtime: domain services, Pi session runtime, oRPC router, HTTP/WS, daemon.                                |
| `packages/client`   | `@getpie/client`          | ~60-LOC factory for a typed oRPC WebSocket client.                                                             |
| `packages/ui`       | `@getpie/ui`              | React components. Subpath-only exports, no barrel.                                                             |
| `apps/app`          | `@getpie/app`             | The SPA — **also a library**: Desktop mounts `PlatformProvider` + `AppInterface` from the root export only.    |
| `apps/desktop`      | `desktop` (unscoped)      | Electron shell supervising a forked server over MessagePort oRPC.                                              |
| `packages/pie`      | `@getpie/cli` (bin `pie`) | Thin CLI over `@getpie/server/{daemon,http}`.                                                                  |

## Boundaries

- **Pi is the only agent.** The server talks to one Pi child process per live
  session. There is no harness registry, no `harnessAgentId`, and no agent
  selection on the wire. `SessionRef` is `{ projectId, sessionId }`.
- **`packages/server/src/harness/`** holds the session domain and the Pi
  implementation under `harness/pi/` (`process.ts`, `runtime.ts`, `agent.ts`,
  `transport.ts`, …). The folder name is legacy; the code is Pi-only.
- **The session domain has five public roles** (no registry): `PiAgent`
  (Effect Context — create/resume/cold reads at the composition root),
  `PiAgentRuntime` (live child handle), `PiAgentSessionManager` (sole owner of
  live state — one session per ref; the only caller of `PiAgent.create`/`resume`),
  and `PiAgentSessionService` (outward face: SessionRef ↔ `agentSessionId`
  translation, metadata persistence, wire vocabulary validation, collection
  events), and `ProjectSessionRemoval` (the narrow cross-domain transaction for
  rejecting busy Project removal and deleting Pie-owned Session data).
  `session.ts`, `session-fold.ts` and `session-repository.ts` are
  private collaborators — no Context tags. `PiAgentSession` (`session.ts`)
  optionally owns a runtime: observing a session costs no process until a prompt
  or history read acquires one. The RPC router contributes only `projectId →
workspace path` (via `ProjectService`) and error-code mapping. Pi sees `cwd`,
  never `projectId`.
- **`ownership/project-lifecycle.ts`** is the neutral keyed coordinator shared
  by Project registry/removal and the outward Session service. Session
  operations acquire their Project permit at the service boundary; Session
  creation is the one exception because `ProjectService.withProject` resolves
  the path while already holding that same non-reentrant permit.
- **`packages/server/src/rpc/runtime.ts`** is the composition root: `PiProcessLayer`
  constructs `PiProcess`, `PiAgent` wraps it with `cachePiAgentAvailability` (one
  `--version` probe per server lifetime), then the session manager and service
  layers consume `PiAgent` directly.
- `EventBusLayer` must stay a single Layer reference across publish and
  subscribe wiring — Effect memoizes layers by reference, and a second
  reference (or `Layer.fresh`) silently splits the bus.
- `packages/ui/src/components/*` is vendored from the coss registry and refreshed
  with `--overwrite`, so edits there get discarded. Fix in the `ai-elements/` or
  `claude-code/` wrappers, or upstream (`docs/adr/0001`). `carousel` and
  `splitter` are the local exceptions.
- `apps/desktop/AGENTS.md` holds that app's own layering contract (allowed and
  forbidden imports per directory, single composition root, `ipcRenderer` only in
  `src/preload/`). Read it before touching `apps/desktop/src`.
- Port binding, auth, CORS, ticketing, static serving → `packages/server/src/http`,
  not the CLI. `packages/server/src/config/paths.ts` is the only place that names
  persistent roots: `resolvePieHome` for Projects and Sessions,
  `resolveDaemonDirectory` for lifecycle state, and `logsDirectory` for
  `$PIE_HOME/logs`. The daemon directory holds only `daemon.pid`, `.lock`, and
  `.stopped`. `Paths` includes `logsDir`; directory `0700` and files `0600` are
  part of that contract (`LOGS_DIRECTORY_MODE` / `LOG_FILE_MODE` in `paths.ts`).
  The process-owned observability Layer appends to `logsDir/pie.log` and
  requires FileSystem, Crypto, and Paths — bound at `runServe` / `NodeServices.layer`.
  Do not seal a platform layer inside the observability module, and do not name
  the log directory a second time. The RPC `ManagedRuntime` must `provideMerge`
  the process context captured after that provide; `mergeAll` leaves fibers forked
  during `AgentRuntimeLayer` construction on Effect's default logger. Tests that
  do not write a log file provide `Observability.discard` so `Effect.log*` does
  not leak to stdout. The single-daemon invariant is keyed on the daemon
  directory, so every front door resolves it there and passes it down —
  `packages/server/src/daemon/paths.ts` names files inside a directory it is
  handed and deliberately has no default of its own.
