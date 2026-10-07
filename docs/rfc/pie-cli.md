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

Session listing, rename, model, archive, project list/create, and Schedule verbs are [ADR 0011](../adr/0011-session-cli-and-mcp.md). `pie ls`, not `pie session ls`. Still proposed here:

```text
pie session show <session-id>
pie session status <session-id>

pie project show <id|path>
pie project rm <id> [--yes]
```

Resolve a session id to its complete SessionRef through `resolveRef`. Project
addressing accepts an id or path; `project create` defaults to cwd and uses
path-idempotent `project.create`. These commands project the existing contract,
not a CLI-owned store. Any missing procedure must land in the same stack.

## Schedule, Hub, and terminal commands

Schedule commands are [ADR 0011](../adr/0011-session-cli-and-mcp.md). They match `scheduleContract` and do not add pause, resume, or logs.

```text
pie hub connect <hub-origin> --expected-environment-id UUID --token-stdin [--url DAEMON]
pie hub status|refresh [--url DAEMON]
pie hub disconnect --expected-environment-id UUID --yes [--url DAEMON]
pie terminal ls|create|send|capture|close …
```

- Hub commands configure the selected Environment through daemon RPC. `--url` /
  `PIE_URL` retains existing connect-only behavior; otherwise use the local daemon.
  The public Hub is a separate binary, never `pie hub serve`. Noninteractive
  token-based setup replaces the earlier unimplemented `login/logout` proposal
  **only if approved**; see the [Hub RFC decisions](pie-hub.md#10-decisions-for-the-developer).
  No CLI-owned relationship store or secret in argv/stdout.
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
