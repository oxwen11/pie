# TOML user settings for pie

- Status: adopted for `$PIE_HOME/config.toml`
- Date: 2026-08-28

## Question

What file format should pie use for **user-facing** settings (the Settings
page, also hand-editable on disk), and how should that file be parsed,
validated, and exposed over RPC?

This is a different job from `projects.json` / session records.
Those are machine-owned collections. Settings are a small, nested document a
human may open in an editor.

## Decision

Store pie-owned settings as **`$PIE_HOME/config.toml`** (not under `storage/`).

- Parse and stringify with **`smol-toml`** (TOML 1.0/1.1, `parse` + `stringify`).
- Validate with the existing Effect Schema on `@getpie/contract`.
- Expose `settings.get` / `settings.update` over oRPC. The UI never reads the
  file itself.
- Missing file → in-memory defaults, no seed write. The first Settings save
  creates the file. Corrupt files fail loud (`INVALID_ARGUMENT`); they are
  never reset.

Pi’s own agent settings stay in Pi. This file is pie UI/daemon config only.

## Why TOML

| Format                     | Hand-edit           | Comments   | Fits this repo                                                         |
| -------------------------- | ------------------- | ---------- | ---------------------------------------------------------------------- |
| JSON (`effect-json-store`) | noisy braces        | no         | Right for `projects.json` / session records; wrong as a user config    |
| JSONC                      | comments            | still JSON | Extra parser; no ecosystem win over TOML here                          |
| YAML                       | indentation hazards | yes        | Easy to silently mis-nest                                              |
| TOML                       | tables + keys       | yes        | Codex, Helix, Alacritty, Starship already train users on `config.toml` |

TOML tables map cleanly onto the schema (`[appearance]`, later `[agent]`).
Integers and booleans stay typed, unlike env-style formats.

`effect-json-store` stays the store for versioned JSON collections. It is not
extended into a TOML engine: its on-disk envelope is `{ version, data }`, which
is a bad TOML document. Settings versioning is a top-level `version = 1` key
instead.

Effect `ConfigProvider` is also the wrong tool: it is process configuration
(env / layered providers), not a user-editable document with a round-trip UI.

## Library: `smol-toml`

- TOML 1.0 compatible, actively maintained, ESM, no native addons.
- Used in production by Vite and pnpm.
- `parse(text)` returns a plain object Effect Schema can decode; `stringify`
  writes canonical TOML.
- Integers come back as JS numbers (safe for `version = 1`).

Rejected: `@iarna/toml` (older, CommonJS-first), `@std/toml` (Deno-oriented).

### Comment preservation

`stringify` does not round-trip comments. A Settings-page save rewrites the
file. The written file starts with a one-line warning so that is obvious.

Hand-edits of values survive until the next UI save. Hand-written comments do
not. That is acceptable for v1; a comment-preserving parser (`@ltd/j-toml`) can
replace `stringify` later without changing the schema or path.

## On-disk shape (v1)

```toml
# pie user settings. Saving from the Settings page rewrites this file.
version = 1

[appearance]
theme = "system" # system | light | dark
```

- Path: `$PIE_HOME/config.toml` via `Paths.configFile`. Not `storage/` —
  `storage/` is data collections (`projects.json`, `sessions/`).
- Mode: `0600`, same contract as other pie-owned files.
- Unknown keys are ignored on read and dropped on write.
- `version` omitted on a hand-written file is treated as `1`. A greater
  version fails loud until a migration exists.
- Atomic write is `writeFileAtomic` from `@getpie/effect-json-store` (tmp +
  rename).

## Wire / UI

`settings.get` and `settings.update` both return `{ settings, path, exists }`.
`update` takes the full `settings` document (not a patch). The Settings route
uses the same AppShell + centered `CardFrame` as `/draft`. Theme is applied to
`document.documentElement` (`.dark` / `color-scheme`); last-used theme is
cached in `localStorage` key `pie:theme:v1` so a reload does not flash the
wrong scheme before the RPC lands.

## Out of scope

- Pi provider keys, default model, MCP — those belong to Pi’s own config.
- File watching / live reload of hand-edits while the UI is open (re-read on
  `get`; the query’s `refetchOnWindowFocus: "always"` picks up a tab switch).
- Schema migrations beyond `version = 1`.
