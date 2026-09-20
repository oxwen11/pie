---
name: pie-cli
description: Use Pie's agent-first CLI to create, continue, wait for, inspect, respond to, or interrupt agent Sessions. Use when operating `pie run`, `pie send`, `pie wait`, `pie logs`, `pie respond`, or `pie interrupt`.
---

# Pie CLI

Use `pie` as a daemon client. Prefer stable stdout and exit codes over terminal prose.

## Start work

```bash
sid=$(pie run -q --no-wait "fix the failing test")
pie wait "$sid" --timeout 10m
pie logs "$sid" --tail 5 --json
```

Without `--no-wait`, `run` and `send` wait up to 30 minutes for the turn to settle.

## Continue work

```bash
pie send "$sid" "run the focused tests" --timeout 10m
```

Set `PIE_SESSION_ID` and optionally `PIE_PROJECT_ID` when repeatedly addressing the same Session.

## Handle states

- Exit `0`: operation completed.
- Exit `1`: usage/business failure, timeout, crash, or pending request.
- `pie wait`: prints `idle` or `request\t<requestId>`.
- Pending request: inspect `pie wait --json`, then `pie respond "$sid" --request <id> --allow|--deny` or `--response '<json>'`.
- Stop an in-flight turn with `pie interrupt "$sid"`.

Use `-q` to carry a Session id. Use `--json` for requests, transcripts, and worktree details. Do not scrape stderr or expect streamed assistant text on stdout.
