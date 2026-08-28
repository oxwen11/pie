# TOML for pie operator settings

## Question

What on-disk format should pie use for operator-facing settings (the Settings
page), and which parser should own read/write?

## Decision

- **File:** `$PIE_HOME/config.toml` — named only in `packages/server/src/config/paths.ts`
  (`configFile`). Not under `storage/`.
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
  in the browser.
- **Writing Pi's settings files:** those belong to Pi.
