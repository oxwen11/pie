# Pie CLI

Normative for `@getpie/cli` (`pie`) and skills that teach it.
Command surface lives in `docs/design/pie-cli.md`. Nouns: `CONTEXT.md`.

## Who it is for

The primary caller is an **agent**. Web / Desktop are for humans.
Do not shape defaults around interactive terminal UX: no prompts,
pagers, color, tables, spinners, or token streaming.

## What it is

`pie` is a **daemon client**: each product command projects
`@getpie/contract` (or daemon lifecycle). It is not a second runtime,
orchestrator, domain store, or workflow engine.

Same vocabulary as the product. Same agent model as the server: **Pi
only** (`--provider` / `--model-id` select a model, never a harness).

No command for a capability the contract does not expose. New command →
name the procedure(s); extend the contract in the same stack, or cut the
command. `pie-verify` stays proof tooling (architecture rules). Hub is a
separate binary — `pie hub *` enrolls the daemon only (`pie-hub.md`).

## Machine interface

Optimize for **decidability**: the caller must know success, failure,
and the next id/state without scraping prose.

- Exit codes drive control flow (`0` ok, `1` business/usage, `2`
  unreachable/unauthenticated target). Extra codes only when they beat
  parsing stdout for that command.
- Default stdout is short, stable text. `-q` = primary id(s) only.
  `--json` = contract-shaped payload, no `{ ok, data }` envelope.
- Errors: non-zero exit + stable stderr. No success-shaped failure
  output. Structured errors only with `--json`.
- Changing a default stdout shape is a breaking change; add a flag
  rather than silently reformatting.

## Addressing

IDs are explicit. No "active" / focused / selector DSL — Pie has no
editor focus model.

Flags override env (`PIE_URL`, `PIE_AUTH_TOKEN`, `PIE_PROJECT_ID`,
`PIE_SESSION_ID`, `$PIE_HOME`). Env is a default, not authority; missing
required id fails clearly.

No `--url` → attach or spawn the local daemon under `$PIE_HOME`.
`--url` / `PIE_URL` connects only — never starts a daemon on that URL.

There is no subagent tree: new work is a new Session unless
`--session-id` / `PIE_SESSION_ID` says otherwise. Project without an id
resolves from cwd via path-idempotent `project.create`.

Destructive ops are non-interactive (`--yes` when a guard is required).

## Docs

Change the command surface → update `docs/design/pie-cli.md` in the same change.
