# On-disk format for pie settings

## Question

What on-disk format should pie use for settings (the Settings page), and which
parser should own read/write?

## Decision

Settings are **agent-facing**. Humans are not the reader. Format is JSON.

- **One file:** `$PIE_HOME/config.json` — named only in
  `packages/server/src/config/paths.ts` (`configFile`).
- **Three owner objects** (T3's three-file split, as keys in one JSON
  document):
  - `ui` — SPA prefs. v1: `ui.theme` (`system` | `light` | `dark`). Server
    owned. CLI `serve` and the desktop renderer call `settings.get` /
    `settings.update`.
  - `desktop` — Electron host. v1: `desktop.window` (bounds). Desktop Main
    reads and writes it **directly** so the window can open before the
    daemon is up. Not on the RPC `Settings` type; `pie serve` does not
    interpret it. Leftover `ui.window` is read until the next save
    relocates it.
  - `agent` — pie-owned operator prefs about the agent. No keys in v1; do
    not write an empty object, and do not proxy Pi's own files through this
    namespace.
- **Merge on write:** each writer overlays its slice and leaves sibling
  objects in place. Settings save must not wipe `desktop.window`; a window
  resize must not wipe `ui.theme`. Unknown objects are preserved.
- **Not Electron `userData`:** that directory stays Chromium / instance-lock
  (`Pie` / `Pie Dev/<worktree>`).
- **Format:** JSON via `JSON.parse` / `JSON.stringify` (pretty-printed,
  2-space indent, trailing newline). No third-party TOML parser.
- **Validation:** Effect Schema after parse (`SettingsSchema` in
  `@getpie/contract` for the `ui` RPC slice; `DesktopWindowStateSchema` in
  the desktop shell for `desktop.window`).
- **Writes:** atomic tmp+rename; mode `0600`. Missing file is defaults in
  memory and is not seeded until the first save (Settings page for theme; a
  window move/resize/close for bounds).
- **Not used:** `@getpie/effect-json-store`'s `{ version, data }` envelope.
  Atomic write helper is reused; the file stays a plain JSON object.

## Why JSON

The reader is an agent, not a person opening an editor. JSON is the JS
platform codec: no extra parser, no 1.0/1.1 split, no comment round-trip
fiction. Agents already emit and consume it. Path (`config.json` vs
`storage/`) keeps this file distinct from Project/Session records; the
`{ version, data }` envelope stays off this document.

TOML's remaining advantages are all "open in an editor" (comments, table
headers, Cargo/Codex muscle memory). Those do not apply here. The JS TOML
ecosystem (`smol-toml` stringify is a full rewrite and drops comments) is
also weaker than `JSON.parse`/`JSON.stringify`.

Pi's own settings stay in Pi's files. Do not proxy Pi model defaults through
`config.json`.

## T3 Code (inspected at `78f462c4`)

T3 is the closest product shape we have (Node server + Electron shell +
shared web UI). Format is JSON. The interesting part is _where_ files live.

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
Do **not** copy T3's three JSON documents. pie keeps one `config.json` and
splits _objects_ by owner the same way T3 splits files:

| Object / key     | T3 file                 | Owner         | How                                                                |
| ---------------- | ----------------------- | ------------- | ------------------------------------------------------------------ |
| `ui` `ui.theme`  | `client-settings.json`  | server        | RPC `settings.get` / `settings.update`. Shared by web and desktop. |
| `desktop.window` | `desktop-settings.json` | Electron Main | Direct file I/O. Not on the wire. `pie serve` ignores it.          |
| `agent`          | `settings.json`         | server        | Empty in v1. Pie-owned operator prefs about the agent, not Pi's.   |

T3 keeps theme-like prefs client-local (web `localStorage` vs desktop
`client-settings.json`). pie does not: appearance follows the operator across
`pie serve` and the desktop shell, so `ui` is server-owned rather than
renderer-local.

Electron `userData` (`Pie` / `Pie Dev/<worktree>`) stays Chromium-only.

Two writers on one file are a lost-update race if both read-merge-write at
once. Theme save is a click; window persist is debounced. Accept that over a
second file.

## Codec

`JSON.parse` / `JSON.stringify`. Unknown keys are dropped from the _decoded
operator slice_ so an older pie can still open a newer file; they are
**kept on disk** when merging a write. Invalid values for _known_ keys fail
loud and never overwrite the file.

A first pass of this note compared JS TOML parsers (`smol-toml`, `@iarna/toml`,
`@ltd/j-toml`, `toml-patch`). That path is closed: settings are not a
hand-edited TOML document.

## Versioning

No `{ version, data }` envelope. v1 is additive: missing keys take defaults,
invalid known values fail. When a breaking change appears, add a top-level
`schema_version` integer rather than wrapping the file in the JSON store
envelope. A leftover `appearance.theme` is read as `ui.theme` and rewritten
under `ui` on the next save.

## Layout on disk

```text
$PIE_HOME/
  config.json          ← ui / desktop / agent
  storage/projects.json
  storage/sessions/…
  worktrees/…
  logs/…
  daemon/              ← lifecycle only
```

```json
{
  "ui": {
    "theme": "system"
  },
  "desktop": {
    "window": {
      "width": 1200,
      "height": 800,
      "maximized": false
    }
  }
}
```

## Rejected

- **TOML / `smol-toml`:** first pass, on the assumption the file was
  hand-edited. Settings are agent-facing; JS has no stdlib TOML; stringify
  drops comments anyway.
- **JSON document in `effect-json-store`:** right engine for projects/sessions;
  the `{ version, data }` envelope is wrong for this file.
- **JSONC:** comments for a reader who is not opening the file; no standard
  stringify.
- **YAML:** significant whitespace, implicit typing.
- **localStorage as source of truth:** the daemon is the owner; the SPA is a
  client. Theme may _apply_ from settings after connect; it must not live only
  in the browser. (T3's web client-settings live in localStorage; pie does not
  follow that for these settings.)
- **`$PIE_HOME/Desktop.toml` / a sibling desktop file:** rejected so UI, host,
  and agent state stay in one document. Window restore still happens in Main
  via direct I/O of `config.json`, not RPC.
- **A canonical rewrite of only the operator slice:** that would wipe
  `desktop.window` on Settings save. Merge-on-write is the requirement that
  makes one file safe.
- **Putting window bounds under `ui`:** leftover `ui.window` is still read and
  relocated to `desktop.window` on save.
- **Electron `userData` / electron-store's default `config.json`:** the typical
  Electron Store path. Rejected so host state sits in the product home.
  `userData` remains Chromium / instance-lock only.
- **A second `config.json` written by desktop:** that would split theme between
  `pie serve` and the Electron app.
- **Writing Pi's settings files:** those belong to Pi.
