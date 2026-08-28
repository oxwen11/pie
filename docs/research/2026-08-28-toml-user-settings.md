# TOML for pie operator settings

## Question

What on-disk format should pie use for operator-facing settings (the Settings
page), and which parser should own read/write?

## Decision

- **File:** `$PIE_HOME/config.toml` — named only in `packages/server/src/config/paths.ts`
  (`configFile`). Not under `storage/`. One product home for CLI `serve` and
  desktop; the server is the only writer. Electron `userData` is not a settings
  home.
- **Format:** TOML 1.0 via `smol-toml` (`parse` / `stringify`).
- **Validation:** Effect Schema after parse (`SettingsSchema` in `@getpie/contract`).
- **Writes:** canonical document + a short header comment; atomic tmp+rename;
  mode `0600`. Missing file is defaults in memory and is not seeded until the
  first Settings save.
- **Not used:** `@getpie/effect-json-store`. That envelope (`{ version, data }`)
  is for machine-owned collections (`projects.json`, session records). A
  human-edited settings file must stay a plain TOML document.

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

**What pie copies, what it does not.** Copy the home rule: `$PIE_HOME` is the
single product directory (`resolvePieHome` in `packages/server/src/config/paths.ts`),
already shared by CLI `serve`, the daemon, and desktop. Electron `userData`
(`Pie` / `Pie Dev/<worktree>`) stays Chromium-only, same idea as T3.

Do **not** copy T3's three-file split for v1. pie's Settings page today is
appearance that should follow the operator across `pie serve` in a browser and
the desktop shell — both are clients of the same daemon. T3 treats theme-like
prefs as _client-local_ (web `localStorage` vs desktop `client-settings.json`),
so the two surfaces can diverge. pie rejects that for operator settings: the
daemon owns `$PIE_HOME/config.toml`; the SPA and the desktop renderer only call
`settings.get` / `settings.update`. Desktop must not write a second
`config.toml`.

A later Electron-host-only key (window bounds, auto-update channel) can be a
sibling file under the same `$PIE_HOME` (T3's `desktop-settings.json` pattern)
or stay in `userData`. It does not belong in `config.toml` and it does not
justify a second pie home.

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
  config.toml          ← operator settings (this design)
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

## Rejected

- **JSON document in `effect-json-store`:** right engine for projects/sessions;
  wrong for a file people open in an editor.
- **Extending the JSON store to TOML:** the envelope and migration chain assume
  JSON. A second codec would fork the package for one file.
- **localStorage as source of truth:** the daemon is the owner; the SPA is a
  client. Theme may _apply_ from settings after connect; it must not live only
  in the browser. (T3's web client-settings live in localStorage; pie does not
  follow that for operator settings.)
- **A second `config.toml` written by desktop:** desktop is a client of the
  same daemon. Two writers on two paths would split theme (and later keys)
  between `pie serve` and the Electron app. Electron `userData` is not a pie
  settings home.
- **Writing Pi's settings files:** those belong to Pi.
