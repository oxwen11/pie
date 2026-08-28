# TOML for pie operator settings

## Question

What on-disk format should pie use for operator-facing settings (the Settings
page), and which parser should own read/write?

## Decision

- **Shared file:** `$PIE_HOME/config.toml` — named only in
  `packages/server/src/config/paths.ts` (`configFile`). The **server** is the
  only writer. CLI `serve` and the desktop renderer call `settings.get` /
  `settings.update`. Theme and other operator prefs live here.
- **Desktop file:** `$PIE_HOME/Desktop.toml` — named as `desktopConfigFilePath`
  in the same `paths.ts`. Electron Main reads and writes it **directly**
  (window bounds today) so the window can open before the daemon is up.
  `pie serve` never reads this file. Prefix is the filename (`Desktop.toml`),
  not a `[desktop]` table inside `config.toml`.
- **Not Electron `userData`:** that directory stays Chromium / instance-lock
  (`Pie` / `Pie Dev/<worktree>`).
- **Format:** TOML 1.0 via `smol-toml` (`parse` / `stringify`).
- **Validation:** Effect Schema after parse (`SettingsSchema` in `@getpie/contract`
  for `config.toml`; `DesktopSettingsSchema` in the desktop shell for
  `Desktop.toml`).
- **Writes:** canonical document + a short header comment; atomic tmp+rename;
  mode `0600`. Missing file is defaults in memory and is not seeded until the
  first save (`config.toml`: Settings page; `Desktop.toml`: a window
  move/resize/close).
- **Not used for either document:** `@getpie/effect-json-store`'s
  `{ version, data }` envelope. Atomic write helper is reused; the files stay
  plain TOML.

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

Pi's own settings stay in Pi's files. This document is pie UI/operator state
(appearance today). Do not proxy Pi model defaults through `config.toml`.

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
Copy the _owner split_ as two sibling files, not T3's three JSON documents and
not Electron `userData`:

| File           | Owner         | Contents                                                   |
| -------------- | ------------- | ---------------------------------------------------------- |
| `config.toml`  | server        | Operator prefs (appearance). Web and desktop both use RPC. |
| `Desktop.toml` | Electron Main | Host-only (window bounds). Direct file I/O, no RPC.        |

Do **not** put `[desktop]` inside `config.toml`. The Settings page rewrites a
canonical document and drops unknown keys, so a shared file would wipe host
state. Two writers on one TOML file are a race. The window must restore before
the daemon answers RPC.

T3 keeps theme-like prefs client-local (web `localStorage` vs desktop
`client-settings.json`). pie does not: appearance follows the operator across
`pie serve` and the desktop shell.

Electron `userData` (`Pie` / `Pie Dev/<worktree>`) stays Chromium-only — not
where `Desktop.toml` lives. That was the alternative (electron-store's default
path); we kept the product home instead and used `Desktop` as the filename
prefix.

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
grow comments we must keep. Until then the Settings page rewrites a canonical
file (header comment is re-applied on every save). Unknown keys are dropped on
read so an older pie can still open a newer file; invalid values for _known_
keys fail loud and never overwrite the file.

## Versioning

No `{ version, data }` envelope. v1 is additive: missing keys take defaults,
invalid known values fail. When a breaking change appears, add a top-level
`schema_version` integer — still TOML, still human-visible — rather than
wrapping the file in JSON.

## Layout on disk

```text
$PIE_HOME/
  config.toml          ← operator settings (server)
  Desktop.toml         ← desktop host settings (Electron Main)
  storage/projects.json
  storage/sessions/…
  worktrees/…
  logs/…
  daemon/              ← lifecycle only
```

```toml
# pie operator settings. Edit this file or use the Settings page.
# Saving from the Settings page rewrites the file and does not keep comments.

[appearance]
theme = "system" # system | light | dark
```

```toml
# pie desktop host settings. Not used by pie serve.
# Saving from the desktop shell rewrites the file and does not keep comments.

[window]
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
- **A `[desktop]` table inside `config.toml`:** the Settings page rewrites a
  canonical document and drops unknown keys. Host state would vanish on save.
  The window also has to restore before the daemon is up, so Main must read a
  file the server does not own.
- **Electron `userData` / electron-store's default `config.json`:** the typical
  Electron Store path. Rejected so desktop host state sits next to
  `config.toml` under `$PIE_HOME`, with `Desktop` as the filename prefix.
  `userData` remains Chromium / instance-lock only.
- **A second `config.toml` written by desktop:** that would split _operator_
  prefs (theme) between `pie serve` and the Electron app. Host state uses
  `Desktop.toml`, not a second copy of the operator file.
- **Writing Pi's settings files:** those belong to Pi.
