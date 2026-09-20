# Pie CLI

## Status

Session work implemented; remaining surfaces proposed. Principles: `.agents/rules/cli.md`.

## Summary

`pie` is an **agent client** for the local pie daemon (and any URL the
agent can auth to). It projects `@getpie/contract`. Humans use Web /
Desktop; this binary optimizes for decidable scripting by agents.

Today (`packages/pie`): lifecycle plus `run` / `wait` / `logs` / `send` /
`respond` / `interrupt`. The remaining command surface lands in the slices below.

## Non-goals

- Human-first TTY UX (tables, prompts, pagers, command browsers)
- JSON-as-default religion — default is **short text + exit codes**;
  `--json` when structure is required
- A second orchestrator, workflow YAML, or CLI-only domain store
- Glossary rejects (`workspace`, `thread`, `automation`, …)
- Browser / computer-use / emulator / host fleets / focus selectors
- `pie hub serve` (Hub is `@getpie/hub`)

## Global interface

```text
pie [--url URL] [-q] [--json] [--home DIR] <command>
```

| Flag / env                          | Role                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `--url` / `PIE_URL`                 | Connect only; never spawn. Token: `PIE_AUTH_TOKEN` or matching local daemon record |
| no `--url`                          | Attach local daemon, spawn if needed (`$PIE_HOME`)                                 |
| `-q`                                | Primary id(s) only, one per line                                                   |
| `--json`                            | Structured stdout (contract-shaped). No `{ ok, data }` envelope                    |
| `PIE_PROJECT_ID` / `PIE_SESSION_ID` | Defaults when flags omitted; flags win                                             |
| `$PIE_HOME`                         | Same home as Desktop — one daemon identity                                         |

**Exit codes:** `0` ok · `1` business/usage · `2` daemon/URL unreachable.

**Default stdout (no `--json`):** short stable text. Typical shapes:

```text
# run / create →
<sessionId>\t<projectId>

# wait →
idle
# or:
request\t<requestId>

# status-ish one-liners stay one line; never ANSI in default mode
```

stderr: diagnostics and errors. Agents chain on stdout + exit code.

## Command surface

### Lifecycle (exists)

```text
pie                         # daemon start (attach or spawn)
pie daemon start|stop|status
pie serve                   # foreground server (no launcher)
```

### Session work

```text
pie run <text>
    [--project-id ID] [--cwd PATH]
    [--session-id ID]
    [--provider NAME --model-id ID]
    [--worktree] [--worktree-base REF]
    [--no-wait]
    [--url URL]

pie wait <session-id> [--timeout DURATION]
pie logs <session-id> [--tail N] [--before-cursor C]
pie send <session-id> <text> [--no-wait]
pie respond <session-id> --request ID <payload-flags>
pie interrupt <session-id>
```

| Command     | Contract                                                                                                                   | Default behavior                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `run`       | `project.create` (idempotent path) → `agent.session.create` or `resolveRef` + optional `setModel` → `subscribe` + `prompt` | Block until turn ends (or `request`); stdout ids (+ `--json` snapshot). `--no-wait`: return ids immediately after prompt accepted |
| `wait`      | `subscribe` / `getStatus`                                                                                                  | Block until `idle`, `request`, or timeout. stdout: `idle` or `request\t<id>`; distinct exit on timeout                            |
| `logs`      | `getMessages` / snapshot                                                                                                   | Recent turns; prefer `--json` for anything beyond a short text dump                                                               |
| `send`      | `prompt` (+ subscribe unless `--no-wait`)                                                                                  | Continue an existing session                                                                                                      |
| `respond`   | `respondToAgentRequest`                                                                                                    | Unblocks a pending agent request                                                                                                  |
| `interrupt` | `interrupt`                                                                                                                | Stop the in-flight turn                                                                                                           |

These may also live under `pie session …`; share one implementation.
Do not invent a third alias set.

`run` without `--session-id` always creates a **new** Session (same
Project). Reuse is explicit. No subagent parent pointer.

No streaming `user:` / `assistant:` playback. Today's stream in `run`
goes away; agents use `wait` / `logs --json` after the turn.

### Session / project

```text
pie session ls [--project-id ID|path] [--all]
pie session show <session-id>
pie session status <session-id>
pie session archive|rm <session-id> [--yes]
pie session model <session-id> --provider NAME --model-id ID

pie project ls
pie project create [path]          # default cwd; path-idempotent
pie project show <id|path>
pie project rm <id> [--yes]
```

Addressing: session positional id via `resolveRef`; project id or path;
cwd → `project.create` when creating work.

### Schedule / Hub / Terminal (later slices)

```text
pie schedule ls|create|update|pause|resume|run|rm|logs …
pie hub login|connect|status|disconnect|logout
pie terminal ls|create|send|capture|close …
```

Schedule flags mirror the contract (`cron` / `every` / `once` /
`manual`, session policy `isolated|owned|existing`). Hub commands only
touch daemon enrollment — never start Hub.

### Deliberately absent

`ask`, `workspace`, provider-runtime switches, focus selectors,
`dispatchCommand` bus, interactive confirmations without `--yes`.

## Agent recipe

```bash
sid=$(pie run -q --no-wait "fix the failing test")
state=$(pie wait "$sid" --timeout 10m)
# if state is request\t… → pie respond "$sid" --request … then wait again
pie logs "$sid" --tail 5 --json
```

Blocking form when the agent wants one shot:

```bash
pie run -q "fix the failing test"    # prints sessionId; exit 0 when idle
# pending request → exit 1 + stderr pointing at respond (or --json body)
```

Exact pending-request exit shape is fixed in the implementing PR; must
stay decidable without scraping prose.

## Skill

`.agents/skills/pie-cli`:

- Prefer `-q` to carry ids; use `--json` for requests/transcripts
- Always `wait` with `--timeout`
- Never ignore a `request` state — `respond` or `interrupt`
- Read `logs` / `status` before another `send` on a busy session
- Do not scrape prose from stderr; parse stdout / `--json` / exit codes

## Land order

Delivery sequencing only — not a design rule.

1. **Rules + this doc** — delivered
2. **Session work + `pie-cli` skill:** default short output for `run`; add
   `wait` / `logs` / `send` / `respond` / `interrupt`; `--json` / `-q`;
   delete stream print — delivered
3. **`session` + `project` noun CRUD**
4. **`schedule` → `hub` → `terminal`**

Each slice: contract already exists or lands in the same stack; update
this doc + skill when stdout shapes freeze.

## Open points (decide in slice PRs)

Frozen for session-work slice:

- blocking `run` / `send` stdout: `sessionId\tprojectId` (`-q` → `sessionId`);
  on pending request also print `request\t<requestId>` (unless `-q`) and exit 1
- `wait` stdout: `idle` | `request\t<requestId>` (`-q` → id only for request);
  timeout / crash → exit 1
- `--json` is a single object (no `{ ok, data }` envelope)
- default `--timeout` is `30m`
- `logs` has `--tail`; no `--before-cursor` until the contract paginates
