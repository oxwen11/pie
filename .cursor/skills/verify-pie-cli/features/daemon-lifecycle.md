# Daemon lifecycle

Bare `pie`, `pie daemon`, and `pie daemon start` attach-or-spawn a detached daemon. The CLI process exits. The daemon writes `$PIE_DAEMON_DIR/daemon.pid` and keeps serving until an explicit stop.

## Sub-features

- **Start** — stdout `pie daemon started at http://127.0.0.1:<port> (pid N)`. Record address from `daemon.pid`, do not guess.
- **Status while running** — `pie daemon running at <address> (pid N)`.
- **Health** — `GET <address>/api/health` → `ok` (no auth).
- **Stop** — `pie daemon stopped`. Writes `daemon.stopped` so supervision does not resurrect it.
- **Status after stop** — `pie daemon is not running`. Health fails. Port is free.

## How to get to it

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-launch
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-doctor
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-evidence init
```

## Driving it

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-run daemon status
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-evidence curl
```

Then stop as the last drive step (or leave it for cleanup — cleanup also stops):

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-run daemon stop
.cursor/skills/verify-pie-cli/bin/verify-pie-cli-run daemon status
```

Proof (all of these):

- Start log contains `pie daemon started at`.
- Status contains `pie daemon running at` and the pid from `daemon.pid`.
- Health is `ok`. Anonymous ticket is 401; bearer ticket is 200.
- After stop: status is `pie daemon is not running`. Do not print the token.

Cleanup still runs after a proof stop — it must be idempotent.
