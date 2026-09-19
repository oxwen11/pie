# Feature map

Source of truth for what a pie CLI proof must cover. Each file is one user-facing command path.

Primary surface: `packages/pie` via `pnpm exec pie-verify cli run` (implementation: `tools/verify`). Harness: CLI + curl. No browser.

| Feature | File | User entry |
| --- | --- | --- |
| Daemon start / status / stop | [daemon-lifecycle.md](daemon-lifecycle.md) | `pie daemon start` then `status` then `stop` |
| Foreground serve | [serve-foreground.md](serve-foreground.md) | `pie serve` / launch `--serve` |
| Attach to a running daemon | [daemon-reuse.md](daemon-reuse.md) | second `pie` / `pie daemon start` |
| Token-gated ticket | [auth-ticket.md](auth-ticket.md) | `POST /api/ws-ticket` |
| Help and flags | [help-and-flags.md](help-and-flags.md) | `pie --help`, `--port` |

Web UI and Electron are sibling skills, not features here.

When commands, stdout, or auth behavior change, edit the matching file.
