# TOML for pie operator settings

## Question

What on-disk format should pie use for operator-facing settings (the Settings
page), and which parser should own read/write?

## Decision

- **One file:** `$PIE_HOME/config.toml` — named only in
  `packages/server/src/config/paths.ts` (`configFile`).
- **Three owner tables** (T3's three-file split, as namespaces in one TOML
  document):
  - `[ui]` — SPA prefs. v1: `ui.theme` (`system` | `light` | `dark`). Server
    owned. CLI `serve` and the desktop renderer call `settings.get` /
    `settings.update`.
  - `[desktop]` — Electron host. v1: `desktop.window` (bounds). Desktop Main
    reads and writes it **directly** so the window can open before the
    daemon is up. Not on the RPC `Settings` type; `pie serve` does not
    interpret it. Leftover `ui.window` is read until the next save
    relocates it.
  - `[agent]` — pie-owned operator prefs about the agent. No keys in v1; do
    not write an empty table, and do not proxy Pi's own files through this
    namespace.
- **Merge on write:** each writer overlays its slice and leaves sibling
  tables in place. Settings save must not wipe `desktop.window`; a window
  resize must not wipe `ui.theme`. Unknown tables are preserved. Comments
  are not.
- **Not Electron `userData`:** that directory stays Chromium / instance-lock
  (`Pie` / `Pie Dev/<worktree>`).
- **Format:** TOML 1.0 via `smol-toml` (`parse` / `stringify`).
- **Validation:** Effect Schema after parse (`SettingsSchema` in
  `@getpie/contract` for the `[ui]` RPC slice; `DesktopWindowStateSchema` in
  the desktop shell for `desktop.window`).
- **Writes:** header comment + atomic tmp+rename; mode `0600`. Missing file is
  defaults in memory and is not seeded until the first save (Settings page for
  theme; a window move/resize/close for bounds).
- **Not used:** `@getpie/effect-json-store`'s `{ version, data }` envelope.
  Atomic write helper is reused; the file stays plain TOML.

## Why TOML

Operator settings are a short, nested, hand-editable document. TOML was
designed for that (tables, comments, no significant whitespace). Nearby tools
already train that habit: Cargo, Helix, Alacritty, Codex (`config.toml`).

| Format | Comments | Nested tables | Spec | Fit                                                                     |
| ------ | -------- | ------------- | ---- | ----------------------------------------------------------------------- |
| JSON   | no       | yes           | yes  | Machine data. Already used under `storage/`.                            |
| JSONC  | yes      | yes           | no   | No standard stringify; not a wire format we want to invent.             |
| YAML   | yes      | yes           | yes  | Significant whitespace, implicit typing. Too ambiguous for a tiny file. |
| TOML   | yes      | yes           | yes  | Matches the job.                                                        |

Pi's own settings stay in Pi's files. This document is pie UI/operator state.
Do not proxy Pi model defaults through `config.toml`.

## T3 Code (inspected at `78f462c4`)

The first pass of this note compared TOML vs JSON/YAML and parsers. It did
**not** look at T3 Code. T3 is the closest product shape we have (Node server +
Electron shell + shared web UI), so the _home_ question is independent of the
format choice.

T3 does **not** use TOML for its own settings. Format is JSON. The interesting
part is _where_ files live, not the codec.

**One product home, not Electron `userData`.** Server paths come from
`deriveServerPaths` in `apps/server/src/config.ts`: `settingsPath` is
`{stateDir}/settings.json`, next to sqlite, logs, keybindings, secrets.
`stateDir` is `{baseDir}/userdata` (or `{baseDir}/dev` when a Vite `devUrl` is
set and `baseDir` is not explicit). `baseDir` is `T3CODE_HOME` / `~/.t3`.
Electron `userData` (`t3code` / `t3code-dev`) is Chromium and the
single-instance lock only — T3 PR #607: the `userData` directory is purely for
Electron/Chromium internals; `~/.t3/userdata` is unaffected.

**Files split _inside_ that home, by owner — not a second home.** Desktop
`DesktopEnvironment.ts` names siblings under the same `stateDir`:

| File                    | Owner                 | Contents                                                                                                                                              |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json`         | server                | Authoritative server config (providers, git fetch, observability). Web and desktop both talk to this via the server.                                  |
| `client-settings.json`  | desktop renderer/main | UI prefs (fonts, glass opacity, timestamps, sidebar). Contract type `ClientSettings`. Web keeps the same schema in localStorage instead of this file. |
| `desktop-settings.json` | Electron main         | Host-only: window bounds, WSL backend, update channel. Must not affect a browser attached to `t3 serve`.                                              |

Web vs desktop is a runtime mode on `ServerConfig` (`"web" | "desktop"`), not a
second settings root.

**What pie copies, what it does not.** Copy the _home_ rule: `$PIE_HOME` is the
single product directory (`resolvePieHome` in `packages/server/src/config/paths.ts`).
Do **not** copy T3's three JSON documents. pie keeps one `config.toml` and
splits _tables_ by owner the same way T3 splits files:

| Table / key        | T3 file                 | Owner         | How                                                                |
| ------------------ | ----------------------- | ------------- | ------------------------------------------------------------------ |
| `[ui]` `ui.theme`  | `client-settings.json`  | server        | RPC `settings.get` / `settings.update`. Shared by web and desktop. |
| `[desktop.window]` | `desktop-settings.json` | Electron Main | Direct file I/O. Not on the wire. `pie serve` ignores it.          |
| `[agent]`          | `settings.json`         | server        | Empty in v1. Pie-owned operator prefs about the agent, not Pi's.   |

T3 keeps theme-like prefs client-local (web `localStorage` vs desktop
`client-settings.json`). pie does not: appearance follows the operator across
`pie serve` and the desktop shell, so `[ui]` is server-owned rather than
renderer-local.

Electron `userData` (`Pie` / `Pie Dev/<worktree>`) stays Chromium-only.

Two writers on one file are a lost-update race if both read-merge-write at
once. Theme save is a click; window persist is debounced. Accept that over a
second file.

## Parser

Compared (2026-08): `smol-toml`, `@iarna/toml`, `@ltd/j-toml`, `@std/toml`,
`toml-patch`.

- **`smol-toml`:** TOML 1.0/1.1, parse+stringify, zero deps, TypeScript-native,
  currently the most downloaded JS TOML parser (Vite uses it). Fastest of the
  set. Does **not** round-trip comments.
- **`@iarna/toml`:** battle-tested, stringify does not emit comments (author
  notes this).
- **`@ltd/j-toml`:** optional comment preservation via symbols; heavier API,
  slower stringify.
- **`toml-patch` / CST editors:** real comment-preserving edits; extra
  machinery we do not need for a one-table file.

**Choice: `smol-toml`.** Comment-preserving rewrite is a follow-up if hand-edits
grow comments we must keep. Until then every save rewrites a canonical file
(header comment is re-applied). Unknown keys are dropped from the _decoded
operator slice_ so an older pie can still open a newer file; they are
**kept on disk** when merging a write. Invalid values for _known_ keys fail
loud and never overwrite the file.

## Versioning

No `{ version, data }` envelope. v1 is additive: missing keys take defaults,
invalid known values fail. When a breaking change appears, add a top-level
`schema_version` integer — still TOML, still human-visible — rather than
wrapping the file in JSON. Pre-`[ui]` documents with `[appearance]` are read
as `ui.theme` and rewritten under `[ui]` on the next save.

## Layout on disk

```text
$PIE_HOME/
  config.toml          ← [ui] / [desktop] / [agent]
  storage/projects.json
  storage/sessions/…
  worktrees/…
  logs/…
  daemon/              ← lifecycle only
```

```toml
# pie settings. Edit this file or use the Settings page.
# Tables: [ui] SPA, [desktop] host, [agent] operator. Saving does not keep comments.

[ui]
theme = "system" # system | light | dark

[desktop.window]
width = 1200
height = 800
maximized = false
```

## Rejected

- **JSON document in `effect-json-store`:** right engine for projects/sessions;
  wrong for a file people open in an editor.
- **Extending the JSON store to TOML:** the envelope and migration chain assume
  JSON. A second codec would fork the package for one file.
- **localStorage as source of truth:** the daemon is the owner; the SPA is a
  client. Theme may _apply_ from settings after connect; it must not live only
  in the browser. (T3's web client-settings live in localStorage; pie does not
  follow that for operator settings.)
- **`$PIE_HOME/Desktop.toml`:** a second file next to `config.toml`. Rejected
  so UI, host, and agent state stay in one document under three owner tables.
  Window restore still happens in Main via direct I/O of `config.toml`, not RPC.
- **A canonical rewrite of only the operator slice:** that would wipe
  `desktop.window` on Settings save. Merge-on-write is the requirement that
  makes one file safe.
- **Putting window bounds under `[ui]`:** the first `config.toml` layout used
  `ui.window`. Rejected so the three owner tables match T3's three files
  (`client-settings` → `[ui]`, `desktop-settings` → `[desktop]`, `settings` →
  `[agent]`). Leftover `ui.window` is still read and relocated on save.
- **Electron `userData` / electron-store's default `config.json`:** the typical
  Electron Store path. Rejected so host state sits in the product home.
  `userData` remains Chromium / instance-lock only.
- **A second `config.toml` written by desktop:** that would split _operator_
  prefs (theme) between `pie serve` and the Electron app.
- **Writing Pi's settings files:** those belong to Pi.
