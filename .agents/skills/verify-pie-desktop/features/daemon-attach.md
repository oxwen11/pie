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

`verify-pie-desktop launch` always allocates a **new** isolated home — it cannot attach to a CLI-prestarted daemon. The "CLI first, then desktop" path is a **manual** `electron-vite dev` with exported env, not the helper.

Default helpers do **not** share roots. To prove attach, export the desktop run's env **and** `PIE_DAEMON_COMPATIBILITY_KEY` (from `daemon.pid` or `@getpie/core/compatibility` `resolveDaemonCompatibilityKey()`) into a CLI `daemon start` — tsx throws without that key. Expect `already running` and the same pid. `daemon status` does not need the key.

## Proof

- `daemon status` pid equals `daemon.pid` pid.
- Desktop ticket still 401/200 against that address.
- Stopping via CLI tears down the backend the window was using (overlay). Do not leave a user daemon on 4000 in this state.
