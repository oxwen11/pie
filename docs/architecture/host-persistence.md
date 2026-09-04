# Host persistence architecture

Last audited: 2026-09-04.

This is the inventory of intentional writes made by Pie's shipped web, CLI,
server, and Desktop surfaces. It covers first-party persistence, browser and
Electron profile storage, repository mutations, and writes delegated to Pi. It
does not attempt to enumerate package-manager/build outputs, test fixtures, or
remote services such as GitHub.

The design approval gate for adding or changing any item in this inventory is
in `.agents/rules/architecture.md` under **Host-write design gate**.

## Ownership model

There are four persistence owners. Their data must not be merged casually:

1. **Pie server data** under `$PIE_HOME`.
2. **Daemon lifecycle state** under `$PIE_DAEMON_DIR`.
3. **Browser/Electron profile state** owned by the renderer origin or Chromium.
4. **Pi and the agent's tools**, which write outside Pie-owned storage under
   Pi's own data root and the selected workspace.

`packages/server/src/config/paths.ts` is the only source of truth for Pie server
roots:

- `$PIE_HOME` overrides the home.
- Otherwise production uses `~/.pie` and `NODE_ENV=development` uses
  `~/.pie-dev`.
- `$PIE_DAEMON_DIR` overrides daemon lifecycle storage; otherwise it is
  `$PIE_HOME/daemon`.
- Development front doors may scope lifecycle state to
  `$PIE_HOME/daemons/<checkout-scope>` while retaining one shared development
  data home.

The Desktop Electron `userData` directory is separate from `$PIE_HOME`.
Changing one does not relocate the other.

## Pie server data

```text
$PIE_HOME/
├── storage/
│   ├── projects.json
│   ├── sessions/<projectId>/<sessionId>.json
│   └── schedules/<scheduleId>.json
├── worktrees/<repository-basename>/<four-character-key>/
└── logs/
    ├── pie.log
    └── daemon-stdio.log
```

### Common JSON storage contract

`projects.json`, session records, and schedule records use
`@getpie/effect-json-store`:

```json
{
  "version": 1,
  "data": {}
}
```

- The business value is under `data`; the envelope owns the integer version.
- Writes validate against the current Effect Schema, create parent directories,
  write a randomly named sibling `<target>.<uuid>.tmp`, then rename it over the
  target. Cleanup removes a leftover temporary file after success, failure, or
  interruption.
- Corrupt JSON, invalid data, and files from a newer version fail without being
  reset or overwritten.
- The library supports ordered schema migrations and legacy adoption, but each
  current store below must declare its own chain explicitly.
- Coordination is process-local only. Documents serialize writes per store;
  collections serialize operations per record id. There is no cross-process
  writer coordination.
- These JSON files and their parent directories do not currently pin owner-only
  modes; effective permissions come from the process umask.

### Projects

| Property      | Current contract                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Path          | `$PIE_HOME/storage/projects.json`                                                                                                                                                    |
| Owner         | `ProjectRepository`                                                                                                                                                                  |
| Data          | `Project[]`; each item is `{ id, name, path, createdAt }`                                                                                                                            |
| Write points  | First repository open seeds `[]`; project create/remove rewrites the whole array                                                                                                     |
| Compatibility | A pre-envelope bare `Project[]` is adopted and rewritten as version 1 on first read                                                                                                  |
| Extension     | Add fields through `ProjectSchema`; a shape change after version 1 requires an explicit migration                                                                                    |
| Retention     | Removing a Project removes only its array entry; schedules remain and may later pause as `project_missing`; session metadata, Pi history, worktrees, and workspace files also remain |

`path` is an absolute registered workspace path and is the only persisted
`projectId -> path` mapping.

### Session metadata

| Property      | Current contract                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Path          | `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json`                                                                            |
| Owner         | `PiAgentSessionRepository`                                                                                                           |
| Data          | One record per session, addressed by the same project/session ids carried in the body                                                |
| Write points  | Create, first Pi open, cwd backfill, first-title stamp, rename, archive/unarchive, model selection, and remembered pull-request refs |
| Compatibility | No envelope migration chain or pre-envelope adoption is currently configured                                                         |
| Extension     | Add persisted fields to `SessionSchema` and the `toStorage`/`fromStorage` mapping; incompatible changes require a version migration  |
| Retention     | Session delete removes this file only; it does not remove a worktree or Pi's native transcript. Archiving retains everything         |

Current record fields:

```ts
{
  sessionId: string;
  projectId: string;
  agentSessionId?: string;
  createdAt: string;
  cwd?: string;
  gitBranch?: string;
  pullRequestRefs?: Array<{ host; owner; repository; number }>;
  provider?: string;
  modelId?: string;
  title?: string;
  archived?: boolean;
  updatedAt?: string;
  historyAvailable?: boolean;
}
```

`agentSessionId` is Pi's native id. Old records where
`agentSessionId === sessionId` are interpreted as unopened, but that
normalization is not a versioned disk migration. A missing `cwd` is backfilled
from the Project and persisted by session preparation; read-only workspace
resolution does not write the backfill.

### Schedules

| Property      | Current contract                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Path          | `$PIE_HOME/storage/schedules/<scheduleId>.json`                                                                                |
| Owner         | `ScheduleRepository`                                                                                                           |
| Data          | One complete `Schedule` per file                                                                                               |
| Write points  | Create/update/delete, run start/settle, pause/enable, next-run advancement, failure-circuit changes, and startup recovery      |
| Compatibility | No envelope migration chain or pre-envelope adoption is currently configured; stored run status `started` decodes as `running` |
| Extension     | `ScheduleSchema` is the source of truth; incompatible changes require a version migration                                      |
| Retention     | Delete removes only the schedule file. Sessions, worktrees, and Pi history created by prior runs remain                        |

The current Schedule contains identity and prompt (`id`, `name`, `projectId`,
`prompt`), cadence (`spec`, `nextRunAt`, optional `expiresAt`/`maxRuns`), session
policy and optional worktree/model selection, enable/pause/failure counters,
timestamps and last-run summary, plus `runs`.

Each run contains `{ id, startedAt, reason, status }` plus optional finish time,
session id, error/skip details, missed count, and a snapshot of the schedule
inputs used for that run. Only the newest 20 runs remain in `runs`;
`firedCount` is the durable counter when older runs fall out of that window.

## Git worktrees and repository metadata

A session or Schedule may request a worktree. `WorktreeService` then:

1. Creates `$PIE_HOME/worktrees/<sanitized-repository-basename>/`.
2. Generates a four-character checkout key and an independent branch named
   `pie/<eight-hex-suffix>`.
3. Runs `git worktree add -b <branch> <path> <start-point>`.

This writes both the checkout under `$PIE_HOME` and Git administrative state in
the source repository, including its branch ref and `.git/worktrees/` metadata.
The session record persists the resulting `cwd` and `gitBranch`; there is no
separate worktree manifest.

If session metadata persistence fails during create, Pie attempts
`git worktree remove --force` as rollback. That removes the checkout and
worktree administration entry, but it does not delete the generated branch
ref. No normal session/project/schedule delete path currently removes a
successfully created worktree or branch, so those writes are retained until an
explicit future cleanup path or manual Git cleanup.

## Daemon lifecycle and logs

The default lifecycle tree is:

```text
$PIE_DAEMON_DIR/               # defaults to $PIE_HOME/daemon
├── daemon.pid
├── daemon.lock
└── daemon.stopped
```

| Path             | Data and behavior                                                                                               | Permissions / lifecycle                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `daemon.pid`     | JSON `{ pid, address, token, startedAt, compatibilityKey? }`; `compatibilityKey` is currently `githash:<8-hex>` | Atomic sibling-temp write, mode `0600`; removed on confirmed stop/replacement/failure. Contains a bearer token |
| `daemon.lock`    | SQLite database used only to hold `BEGIN IMMEDIATE` across launch/attach/stop decisions                         | Mode follows umask; SQLite may create transient journal sidecars. The file remains after the transaction       |
| `daemon.stopped` | Decimal epoch-millisecond timestamp; file existence is the stop signal                                          | Direct mode-`0600` write; explicit start removes it                                                            |

The daemon directory itself uses normal mkdir/umask behavior.

`$PIE_HOME/logs` is created with mode `0700`; log files use `0600`:

- `pie.log` is an unbounded append-only structured `key=value` process log. It
  can include workspace paths and operational errors.
- `daemon-stdio.log` receives detached daemon stdout/stderr. At daemon spawn it
  is truncated to zero when already larger than 1,000,000 bytes, then opened in
  append mode; it can exceed the cap until the next spawn.

Stopping Desktop does not stop or delete the detached daemon, its state, or its
logs.

## Browser-owned state

Browser storage is scoped by origin. The web development/served origins and the
Desktop `pie://app` origin therefore do not share state.

### Content panel

| Property      | Current contract                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key           | localStorage `pie:content-panel`                                                                                                                                   |
| Owner         | `ContentPanel` through Zustand persist                                                                                                                             |
| Envelope      | `{ state: { bySessionKey }, version: 0 }`                                                                                                                          |
| Data          | Per `SessionRef` key: `{ presentation, activeId, panels[] }`; a panel record is `{ id, type, payload }`                                                            |
| Compatibility | No Zustand `migrate` callback. Each registered panel may parse its own payload. Unknown or invalid panel records stay stored but are hidden until compatible again |
| Retention     | No automatic pruning. `forget(ref)` can remove one session, but no production caller currently invokes it                                                          |

Live panel instances, loaded content, spinners, and scrollback are intentionally
not persisted.

### Shell layout

`react-resizable-panels` owns these localStorage entries:

```text
react-resizable-panels:pie:shell-layout:<panel-id>:<panel-id>...
```

The suffix is the active ordered set drawn from `sidebar`, `main`, and
`content`; the value is a JSON object mapping each panel id to its numeric size.
The library also has a backward reader for the older group-only key
`react-resizable-panels:pie:shell-layout`, whose value grouped `{ layout: [] }`
records by comma-joined panel ids. Pie defines no independent schema version or
migration for this data.

### Sidebar cookie

`SidebarProvider` writes cookie `sidebar_state` with value `"true"` or
`"false"`, path `/`, and a seven-day expiry. No explicit SameSite, Secure, or
schema-version attributes are set. The app only interprets the literal
`sidebar_state=false` as closed.

### User-mediated browser outputs

Copy actions write assistant/code text to the system clipboard. Download
controls are delegated to the rendering library and browser download handling;
they are user-initiated output, not Pie application state, and have no Pie-owned
migration or retention policy.

## Electron profile storage

Packaged Desktop leaves Electron's standard `userData` path unchanged. For the
current product name `Pie`, typical paths are:

- macOS: `~/Library/Application Support/Pie`
- Linux: `$XDG_CONFIG_HOME/Pie` or `~/.config/Pie`
- Windows: `%APPDATA%\\Pie`

Development uses `<appData>/Pie Dev/<checkout-scope>`. Remote-debug mode uses
`<temp>/pie-desktop-remote-debugging-<port>`. E2E may supply its own
`--user-data-dir`.

Electron/Chromium owns the contents: Local Storage (including the keys above),
cookies, Preferences, IndexedDB/Session Storage if dependencies use them,
service-worker state, caches, GPU data, network state, crash/metrics files, and
profile locks. Pie does not define schemas, migrations, size bounds, or normal
cleanup for this tree. The remote-debug temporary profile is not explicitly
removed by Desktop.

## Pi-owned and workspace writes

Pie launches the external Pi executable with `--mode rpc`, the session cwd, and
optionally `--session-id`. From that boundary onward there are two classes of
writes which Pie intentionally does not own:

1. **Pi native data.** Pi owns transcript and agent configuration formats. Pie
   does not pass `--session-dir`, so current Pi chooses the transcript directory
   in this order: `PI_CODING_AGENT_SESSION_DIR`, the Pi setting `sessionDir`,
   then `$PI_CODING_AGENT_DIR/sessions/--<encoded-cwd>--/`, with
   `PI_CODING_AGENT_DIR` defaulting to `~/.pi/agent`. Files are named
   `<timestamp>_<session-id>.jsonl`. New entries are normally appended to a
   versioned entry tree, but Pi may rewrite the complete file during its own
   migrations. Pi may also update other files under its agent directory, such
   as settings, auth/model, trust, extension, or package state, when its own
   migrations and features require them. Pi, not Pie, owns those schemas and
   migrations. These locations and formats are informative, not a Pie storage
   contract, because the executable can be replaced independently.
2. **Workspace mutation.** Agent tools and commands may create, edit, rename, or
   delete arbitrary files under the selected project/worktree and may invoke
   other host tools with their own state. The paths and data structures are
   task-specific. Permission/confirmation behavior belongs to Pi's tool and
   extension runtime; Pie transports those requests and responses.

Pie session deletion does not delete Pi native data or undo workspace changes.
Any design that starts depending on Pi's physical files rather than its public
runtime behavior requires a new Developer-approved persistence decision.

## Current retention and migration gaps

These are current architecture facts, not implicit approval to preserve them in
new designs:

- There is no product-wide uninstall or "delete all local data" operation.
- Project deletion is not cascading.
- Session and Schedule deletion do not clean up worktrees, branches, Pi
  transcripts, or workspace changes.
- `pie.log` is unbounded; Electron profile/cache growth is Chromium-managed.
- Browser persistence has no Pie-owned versioned migration framework.
- The Project, Session, and Schedule application-data stores are all envelope
  version 1; only Projects adopts a pre-envelope format. Daemon lifecycle JSON
  is outside that envelope system.
- Server data JSON permissions and the daemon SQLite lock mode rely on umask.
- JSON coordination is not cross-process, so one `$PIE_HOME` assumes one active
  server writer even when lifecycle directories are split.
