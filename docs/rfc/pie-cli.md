# Pie CLI: remaining command surfaces

Status: proposed extensions to the existing CLI, not a command reference.
Machine-interface and addressing rules live in [CLI rules](../../.agents/rules/topics/cli.md);
use `pie --help` and each command's `--help` for the implemented surface.

## Current baseline

[`packages/pie`](../../packages/pie/) already provides daemon lifecycle, `serve`,
`run` / `wait` / `logs` / `send` / `respond` / `interrupt`, pairing, and relay
commands. Session work is implemented in
[`session-cli.ts`](../../packages/pie/src/node/session-cli.ts).
`logs` supports `--tail`, not `--before-cursor`; pagination requires a contract
change before a CLI flag. This RFC does not change existing output or exit codes.

## Session and project commands

Proposed syntax, not available commands:

```text
pie session ls [--project-id ID|path] [--all]
pie session show <session-id>
pie session status <session-id>
pie session archive|rm <session-id> [--yes]
pie session model <session-id> --provider NAME --model-id ID

pie project ls
pie project create [path]
pie project show <id|path>
pie project rm <id> [--yes]
```

Resolve a session id to its complete SessionRef through `resolveRef`. Project
addressing accepts an id or path; `project create` defaults to cwd and uses
path-idempotent `project.create`. These commands project the existing contract,
not a CLI-owned store. Any missing procedure must land in the same stack.

## Schedule, Hub, and terminal commands

```text
pie schedule ls|create|update|pause|resume|run|rm|logs …
pie hub login|connect|status|disconnect|logout
pie terminal ls|create|send|capture|close …
```

- Schedule flags mirror contract specs (`cron` / `every` / `once` / `manual`)
  and session policies (`isolated` / `owned` / `existing`).
- Hub commands only configure daemon enrollment. The public Hub is a separate
  binary, never `pie hub serve`; see the [Hub RFC](pie-hub.md).
- Terminal commands require the matching terminal contract; no focus selectors,
  host fleets, command bus, or second orchestrator.

## Delivery and unresolved interface details

Land `session` + `project` first, then `schedule`, `hub`, and `terminal` as
separate concerns in a stack. For each slice, name the contract procedures,
settle flags and stable text/JSON/error shapes, and update command help and any
skills that teach the commands. Remove the implemented portion from this RFC.

Do not add human-first TTY prompts, pagers, token playback, workflow YAML, or
aliases without a concrete caller. Destructive operations remain non-interactive,
with `--yes` where an explicit guard is required.
