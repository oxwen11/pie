# Daemon reuse

A second CLI against the same `$PIE_HOME` / `$PIE_DAEMON_DIR` must attach, not spawn a second listener.

## How to get to it

Launch once, then run start again without cleanup.

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli launch
.cursor/skills/verify-pie-cli/bin/verify-pie-cli run daemon start
```

## Driving it

Proof:

- Second start stdout is `pie daemon already running at <address> (pid N)`.
- Pid and address match the first `daemon.pid`.
- If you pass `--port` that differs from the running port: a note that `--port` was ignored.
- Only one listener on the recorded port.

Do not prove this by pointing two different `PIE_HOME` values at the same port.
