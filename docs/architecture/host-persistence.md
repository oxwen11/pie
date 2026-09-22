# Host persistence architecture

Last audited: 2026-09-20.

This is the inventory of intentional writes made by Pie's shipped web, CLI,
server, and Desktop surfaces. It covers first-party persistence, browser and
Electron profile storage, repository mutations, and writes delegated to Pi. It
does not attempt to enumerate package-manager/build outputs, test fixtures, or
remote services such as GitHub.

The design approval gate for adding or changing any item in this inventory is
in [.agents/rules/persistence.md](../../.agents/rules/persistence.md) under
**Host-write design gate**.

## Ownership model

There are four persistence owners. Their data must not be merged casually:

1. **Pie server data** under `$PIE_HOME`.
2. **Daemon lifecycle state** under `$PIE_HOME/daemon`.
3. **Browser/Electron profile state** owned by the renderer origin or Chromium.
4. **Pi and the agent's tools**, which write outside Pie-owned storage under
   Pi's own data root and the selected workspace.

`packages/server/src/config/paths.ts` is the only source of truth for Pie server
roots:

- `$PIE_HOME` overrides the home.
- Otherwise the default is chosen from the running code's on-disk location
  (not `process.cwd()`):
  - installed binary, not inside a Git checkout → `~/.pie`;
  - Git checkout (dev, or a build launched from the repo) →
    `~/.pie_<sanitized-branch>` (`main` → `~/.pie_main`, `feat/foo` →
    `~/.pie_feat--foo`; `/` becomes `--` so it does not collide with `-`;
    detached HEAD uses the short SHA);
  - checkout whose branch cannot be read → `~/.pie_dev`.
- `NODE_ENV` does not choose the home. Isolation is a different `$PIE_HOME`;
  tests and verify runs must set their own and must not use `~/.pie`,
  `~/.pie_dev`, or `~/.pie_<branch>`.
- Daemon lifecycle storage is always `$PIE_HOME/daemon`.

The Desktop Electron `userData` directory is separate from `$PIE_HOME`.
Changing one does not relocate the other.

## Pie server data

```text
$PIE_HOME/
├── settings.json
├── storage/
│   ├── projects.json
│   ├── sessions/<projectId>/<sessionId>.json
│   └── schedules/<scheduleId>.json
├── worktrees/<repository-basename>/<four-character-key>/
├── logs/
│   ├── pie.log
│   └── daemon-stdio.log
└── daemon/
    ├── daemon.pid
    ├── daemon.lock
    └── daemon.stopped
```

### User settings

| Property      | Current contract                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path          | `$PIE_HOME/settings.json`                                                                                                                           |
| Owner         | `SettingsRepository` (server). Desktop Main may **read** the file for the window background before the renderer loads; it does not write.           |
| Data          | Bare JSON, no envelope. `appearance.theme` is `system`, `light`, or `dark`. Root keys are settings pages.                                           |
| Write points  | `settings.update` only. Missing file is in-memory defaults and is not created on `settings.get`.                                                    |
| Compatibility | Missing keys take defaults. Invalid known values, corrupt JSON, and unreadable files fail without reset. Unknown keys are dropped on the next save. |
| Extension     | Add fields under `appearance` or a new page-named root object. A breaking change may add a sibling `"version"` later.                               |
| Retention     | Retained with `$PIE_HOME`. No separate uninstall. Permissions follow umask, like `projects.json`.                                                   |
| Atomicity     | `writeFileAtomic` (sibling temp + rename). Process-local write semaphore. One daemon writer per `$PIE_HOME`.                                        |

Renderer `localStorage pie:theme` remains a FOUC cache of `appearance.theme` (see Browser-owned state). Server is the source after attach.

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
| Data          | `Project[]`; each item is `{ id, name, path, createdAt, type? }`. `type: "chat"` is set by `project.allocateChatProjectDir`; omitted means imported                                  |
| Write points  | First repository open seeds `[]`; project create/remove rewrites the whole array                                                                                                     |
| Compatibility | A pre-envelope bare `Project[]` is adopted and rewritten as version 1 on first read                                                                                                  |
| Extension     | Add fields through `ProjectSchema`; a shape change after version 1 requires an explicit migration                                                                                    |
| Retention     | Removing a Project removes only its array entry; schedules remain and may later pause as `project_missing`; session metadata, Pi history, worktrees, and workspace files also remain |

`path` is an absolute registered workspace path and is the only persisted
`projectId -> path` mapping.

### Allocated project folders

A draft send with no selected Project calls `project.allocateChatProjectDir`, which creates
an empty folder and then registers it through `ProjectService.create` (the
same `projects.json` write as import).

| Property      | Current contract                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path          | `~/Pie/<YYYY-MM-DD>/Chat-<n>/`                                                                                                                                                                          |
| Owner         | The user. Pie creates the directory; Pi and agent tools write inside it afterwards. `ProjectRepository` only stores the registered `path`                                                               |
| Root          | `~/Pie` via `Paths.chatProjectsDir` in `packages/server/src/config/paths.ts` — user data, not `$PIE_HOME`                                                                                               |
| Name          | Date parent is local-calendar `YYYY-MM-DD`. Leaf is `Chat-1`, then `Chat-2`, `Chat-3`, … (not the first prompt). Exclusive mkdir on the leaf. At most 100 attempts. `Project.name` is the leaf basename |
| Write points  | `ProjectService.allocateChatProjectDir` mkdir of the root (recursive, first use), the date parent (recursive), and the leaf (exclusive). No files are placed in the new folder                          |
| Permissions   | Umask, same as imported project folders. No owner-only mode is pinned                                                                                                                                   |
| Compatibility | New folders only. Existing Projects and imported paths are unchanged                                                                                                                                    |
| Extension     | Change the Paths field or the naming helper (date segment + leaf); do not add a caller-supplied allocate path on the wire                                                                               |
| Retention     | Removing a Project still does not delete the folder. There is no uninstall cleanup of `~/Pie`                                                                                                           |

Tests use `layerPaths(home)` so the chat root sits under the temp `$PIE_HOME`.
Verify sets `HOME` under the run so `~/Pie` resolves inside that run.

### Session metadata

| Property      | Current contract                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Path          | `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json`                                                                            |
| Owner         | `PiAgentSessionRepository`                                                                                                           |
| Data          | One record per session, addressed by the same project/session ids carried in the body                                                |
| Write points  | Create, first Pi open, cwd backfill, first-title stamp, rename, archive/unarchive, model selection, and remembered pull-request refs |
| Compatibility | No envelope migration chain. A legacy `gitBranch` string is lifted to `worktree: { branch }` on read and is never written back       |
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
  worktree?: { branch: string };
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

## Pi package settings and installs

Package configuration is Pi-owned state outside `$PIE_HOME`. Pie exposes it in
the Plugins UI through `PackageService`; it does not duplicate the configuration
under Pie storage.

| Property      | Current contract                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path          | `$PI_CODING_AGENT_DIR/settings.json`; Pi defaults the directory to `~/.pi/agent`.                                                                                                                                                                               |
| Owner         | Pi SDK `SettingsManager` / `DefaultPackageManager`. Pie's `PackageService` invokes those APIs for user-scope packages only.                                                                                                                                     |
| Data          | Pi's bare settings JSON. This feature changes only the `packages` array and preserves other current file fields. New entries are package source strings accepted by Pi, such as `npm:name`, `git:https://host/owner/repo`, or a local path.                     |
| Write points  | `packages.add` and `packages.remove`. Both await Pi's settings write queue before RPC success and surface persistence failures. They update settings only; they do not install or uninstall package files immediately.                                          |
| Compatibility | Pi owns settings parsing and migrations. Missing settings start from `{}`. Corrupt or unreadable settings refuse the change without overwrite. Pi merges the modified `packages` field into the latest locked file contents so unrelated settings are retained. |
| Atomicity     | Pi serializes each manager's write queue and uses `proper-lockfile` across processes, then rewrites the JSON file directly; there is no sibling-temp rename. Effective file and directory permissions follow umask.                                             |
| Retention     | Removing a source removes only its settings entry. Existing package files remain under Pi's managed `npm/` or `git/` directories until Pi or the user removes them. Clearing `$PIE_HOME` does not remove Pi settings or installed packages.                     |

At the next Pi session start, Pi resolves configured sources and may use its
configured npm command or Git to install missing content below the same agent
directory. Those delegated package-manager writes use Pi's existing layout and
lifecycle; Pie Desktop does not require or spawn a separately installed `pi`
CLI.

## Git worktrees and repository metadata

A session or Schedule may request a worktree. `WorktreeService` then:

1. Creates `$PIE_HOME/worktrees/<sanitized-repository-basename>/`.
2. Generates a four-character checkout key and an independent branch named
   `pie/<eight-hex-suffix>`.
3. Runs `git worktree add -b <branch> <path> <start-point>`.

This writes both the checkout under `$PIE_HOME` and Git administrative state in
the source repository, including its branch ref and `.git/worktrees/` metadata.
The session record persists the resulting `cwd` and `worktree: { branch }` so a
removed checkout can be restored at that path. There is no separate worktree
manifest. Checkouts must stay under `$PIE_HOME/worktrees/`. `prepare` and prompt do not re-create a worktree checkout or require `HEAD`
to match the stored branch. When the stored `cwd` directory is gone,
`prepare` fails with `WORKTREE_MISSING` for worktree sessions and otherwise
creates the directory. `session.restoreWorktree` is the explicit worktree
write: `git worktree prune` then `git worktree add <cwd> <branch>` at the
stored path. It does not mint a new key or branch. If the directory already
exists it is a no-op.

If session metadata persistence fails during create, Pie attempts
`git worktree remove --force` as rollback. That removes the checkout and
worktree administration entry, but it does not delete the generated branch
ref. No normal session/project/schedule delete path currently removes a
successfully created worktree or branch, so those writes are retained until an
explicit future cleanup path or manual Git cleanup.

## Daemon lifecycle and logs

The default lifecycle tree is:

```text
$PIE_HOME/daemon/
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

## Proposed resource diagnostics (not implemented)

[Resource monitoring design](../design/resource-monitoring.md) proposes independent
sidecar OS sampling and separate runtime writers. This is a **pending host-write
review**, not a change to the current log inventory above. The user has confirmed
**default-on at process startup**: an unset `PIE_RESOURCE_LOGGING` or `1` enables
monitoring; `0` disables it. Module imports and unit-test construction do not
implicitly start writers. The [code architecture proposal](../design/resource-monitoring-code-architecture.md)
locates the process composition and shared writer modules.

| Proposed path                                                     | Owner / scope                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$PIE_HOME/logs/resources/os/<UTC-created-at>.jsonl`              | Sidecar; relevant local process OS samples                                                                                                                               |
| `$PIE_HOME/logs/resources/daemon/<UTC-created-at>.jsonl`          | Daemon or foreground server; its runtime memory and event-loop samples                                                                                                   |
| `$PIE_HOME/logs/resources/electron/<UTC-created-at>.jsonl`        | Electron main; runtime memory and Electron process metrics                                                                                                               |
| `$PIE_HOME/logs/resources/{os,daemon,electron}/.writer.lock`      | Proposed per-source exclusive writer/cleanup ownership: Rust platform file lock for os, SQLite BEGIN IMMEDIATE in each TS file worker for daemon/electron; not telemetry |
| `$PIE_HOME/logs/resources/{daemon,electron}/.writer.lock-journal` | Possible bounded SQLite rollback-journal metadata; same owner-only permissions as the lock; no WAL or metric database                                                    |

Roots would be derived only from `config/paths.ts` / `Paths.logsDir`, retaining
existing `PIE_HOME` override rules. The proposal uses date-named JSONL, no runId
subdirectories, exclusive file creation, owner-only directory/file permissions,
versioned numeric/process-identity records, per-file retention headers and
sample-completeness markers, and no commands, content, paths, or credentials.
The optimized proposal admits at most one sample round in flight (1 MiB encoded),
keeps the whole round in one JSONL file, and skips new rounds while busy instead
of queuing history. Explicit partial coverage and end markers remain necessary:
one submission is not an atomic disk transaction. Business logs remain unchanged.

The user has confirmed seven-day maximum retention with expiry deletion and
rolling logs: 16 MiB per file, 64 MiB per source (192 MiB total JSONL). Writers
evict the oldest closed files and continue writing; normal budget exhaustion
must not disable logging. File headers track the earliest permitted sample time,
not mtime, so appends/touch cannot extend retention. Known-name files with invalid
retention headers are conservatively evicted. Writer errors retry automatically;
external files, lock metadata and filesystem overhead are not a disk-wide quota.
Whole-round rotation can leave less than 1 MiB unused at the end of a file;
this trades packing efficiency for simpler retention and reading.

Cleanup runs only while the source is enabled and owns its lock, with startup
cleanup before new writes; it cannot delete on schedule during shutdown, sleep,
logging disablement or I/O failure. The proposed timing defaults, per-source lock
backends/metadata, non-owner behavior, permissions, compatibility, corrupt/newer-data
handling, shutdown behavior and uninstall policy are specified in design sections
3–9 and require confirmation under section 12 before implementation. Older
releases ignore this new subtree; no business-data or Pi-transcript migration is
proposed. Inventory status changes to shipped only in the slice that actually
enables the corresponding verified host writes, not in the contracts-only slice.

## Browser-owned state

Browser storage is scoped by origin. The web development/served origins and the
Desktop `pie://app` origin therefore do not share state.

### Theme preference

| Property      | Current contract                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Key           | localStorage `pie:theme`; `ThemeProvider.storageKey` may override it                                                                        |
| Owner         | `ThemeProvider`                                                                                                                             |
| Data          | One string: `"system"`, `"light"`, or `"dark"`                                                                                              |
| Write points  | `setTheme` writes the selected preference directly with browser-managed, origin-scoped last-writer-wins behavior                            |
| Compatibility | Missing, inaccessible, or unrecognized values fall back to `defaultTheme` without rewriting storage; there is no version or migration chain |
| Retention     | Retained until browser site data or the Electron profile is cleared; Pie has no separate cleanup or uninstall path                          |

The current application roots and their build-generated early bootstrap share
the default key from `theme.ts`, so a stored renderer preference is applied
before React mounts without duplicating the decision logic in each HTML file.
After the client attaches, `settings.get` is the source and the cache is
rewritten to match. Electron Main reads `$PIE_HOME/settings.json` once when
creating the window and paints `backgroundColor` from `appearance.theme`
(system / missing / unreadable → OS `nativeTheme`).

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

| Property      | Current contract                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Key           | localStorage `pie:shell-layout`                                                                                    |
| Owner         | `ShellLayout`                                                                                                      |
| Data          | `{ sidebarWidth, contentBySession }`. Sidebar pixels clamped 192–480 (default 256). Content pixels per session key |
| Compatibility | No version. Unreadable envelopes fall back to defaults                                                             |
| Retention     | No automatic pruning                                                                                               |

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

## Verify project picker isolation

Web and Desktop Verify runs create one disposable sample workspace beneath the
run's only `$PIE_HOME`:

```text
$PIE_HOME/workspace/verify-pie[-desktop]-sample/
├── .verify-pie[-desktop]-scaffold
└── README.md
```

Verify owns these non-sensitive, umask-permissioned files and sets
`PIE_PROJECT_BROWSE_ROOT=$PIE_HOME/workspace` and
`PIE_CHAT_PROJECTS_DIR=$PIE_HOME/Pie` for the run's server. It does not change
`HOME`, so `~/.pi/agent` stays the operator's model catalog. When
`PIE_PROJECT_BROWSE_ROOT` is set, the project picker starts at that directory,
reports no parent there, and resolves real paths before rejecting traversal or
symlinks outside it. An unset or blank browse root preserves the production
default of the operator's home directory. Parallel runs do not share a
`$PIE_HOME`; they do share `~/.pi/agent`.

The sample has no independent schema or migration. Its marker retains the
existing cleanup compatibility check. Fresh Web and Desktop runs also seed the
normal version-1 `$PIE_HOME/storage/projects.json` envelope with this sample;
the server remains the schema owner. `launch --empty-projects` skips that file
only for import-flow verification. Normal cleanup removes the sample and then
the whole run; it no longer probes the operator's home for a same-named legacy
sample. Interrupted runs are retained with the rest of `$PIE_HOME` until normal
Verify cleanup. Uninstall behavior is unchanged.

## Development Electron installation

Desktop `dev` and `preview` (including `pie-verify desktop launch`) invoke
Electron's official `install-electron` before starting electron-vite. This
materializes `dist/` and `path.txt` in the resolved Electron dependency package
and uses the installer's download cache and environment overrides. These are
dependency-owned artifacts, not Pie application data: Electron owns their
format, version checks, extraction permissions and retry behavior. Pie adds no
storage schema, migration or concurrent-install lock. Verification cleanup
leaves the installed binary and shared download cache intact; packaged startup
is unchanged.

Verify prepares Electron before starting its service-readiness timeout. Both
preparation and Desktop append to the existing run-local `logs/electron-vite.log`.
The existing decimal `pids/electron-vite.pid` tracks the active launch phase:
installer first, removed on successful installation, then replaced by the Desktop
launcher pid. Paths, permissions and file formats are unchanged; older cleanup
code can still stop the recorded process. Installation/startup failure or
SIGINT/SIGTERM uses the normal run cleanup and failure-log retention, without
removing Electron's dependency-owned binary or download cache.

## Verify Desktop browser binding

Verify uses agent-browser's existing native binding, not a second lock or target
store. Fresh Desktop launch selects the existing renderer and then pins it;
Doctor, reuse and evidence retain that binding. Runs without a usable binding
must be cleaned up and relaunched, not automatically rebound.

The native owner writes `{ targetId, url, pinned }` to
`<socketDir>/namespaces/<session>/run/<session>.target`. The socket directory is
normally `/tmp/pvs-<run-hash>`, derived from the run's real path; the existing
`VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR` override remains caller-owned configuration
and must not be shared by parallel runs. Agent-browser strips URL credentials,
query and fragment, writes mode `0600` via a synced temporary file and rename,
and restores the binding across its daemon restarts. Corrupt or unreadable
bindings fail closed. Native format evolution and backward compatibility remain
agent-browser-owned; Verify does not read or rewrite this file. Run metadata,
browser config formats and permissions are unchanged. Existing cleanup removes
managed socket trees with the run; no migration or separate uninstall is added.

## Verify automatic browser recording

Web and Desktop Verify pin agent-browser 0.37.1. The run's shim starts recording
before its first browser command and retains the same take for later commands:

```text
.agents/skills/verify-pie[-desktop]/evidence/<run-id>/recording-<NNN>.webm
```

`evidence init` stops the current take and advances the run-local
`agent-browser-recording-sequence` integer before the next browser command.
Verify owns that ephemeral pointer, the output path, and the fixed 60 fps
policy; agent-browser and ffmpeg own the WebM/VP8 bytes. The file follows the process umask and may contain sensitive UI
content, local paths, or typed input, so it is gitignored and must only be
uploaded as deliberate evidence. Parallel runs write different run-id paths.
An already-active take is reused rather than replaced.

Normal cleanup asks agent-browser to stop and flush the file before terminating
the browser or Electron, then retains it with the other evidence. A crash may
leave an incomplete WebM. There is no Pie schema, migration, retention limit, or
uninstall removal for evidence files; upgrading agent-browser changes future
recordings only.

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

Pie launches its `pie-pi-process` child (`dist/pi-process/pi-process.js`, Bun)
with the session cwd and optionally `--session-id`. From that boundary onward there are two classes of
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
  server writer.
