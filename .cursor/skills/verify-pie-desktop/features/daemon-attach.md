# Daemon attach

Desktop and CLI share `resolveOrSpawnDaemon`. The same `$PIE_HOME` + `$PIE_DAEMON_DIR` must converge on one backend.

## How to get to it

1. Start an isolated CLI daemon (`verify-pie-cli launch` uses 4182 — **different root**). For a same-home proof, start the CLI **inside the desktop run's env** instead:

```bash
# after verify-pie-desktop launch
export PIE_HOME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/verify-pie-desktop/current/meta.json","utf8")).pieHome)')"
export PIE_DAEMON_DIR="$PIE_HOME/daemon"
cd packages/pie && pnpm exec tsx src/node/cli.ts daemon status
```

Or: launch desktop against a home that already has a daemon (start CLI first with `PIE_HOME` / `PIE_DAEMON_DIR` / `PIE_PORT` exported to the desktop launch). Default helpers do **not** share roots. To prove attach, export the desktop run's env into a CLI `daemon start` — expect `already running` and the same pid.

## Proof

- `daemon status` pid equals `daemon.pid` pid.
- Desktop ticket still 401/200 against that address.
- Stopping via CLI tears down the backend the window was using (overlay). Do not leave a user daemon on 4000 in this state.
