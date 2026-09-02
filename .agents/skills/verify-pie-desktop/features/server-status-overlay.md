# Server status overlay

After the first connect, the host owns reconnect / failed. The overlay is `apps/app/src/server-status-overlay.tsx` (shared with web). Initial splash is **not** this overlay.

## Copy

- Reconnect: **Reconnecting…** / **The local server restarted. Reconnecting to it now.**
- Failed: title **The local server stopped**; subtitle **Pie couldn't keep its server running. Retry, or quit and reopen the app.**; buttons **Quit** and **Retry** (`platform.quit` is always wired on desktop).

## How to get to it

Need a connected real window (or e2e `driveServerToFailed` in `desktop-rpc.spec.ts`, which kills the server child repeatedly). Do not `pkill` by name. If you kill, kill only the **recorded daemon pid** from `daemon.pid`.

Desktop supervision may respawn unless a `daemon.stopped` tombstone is present (`pie daemon stop`). An explicit stop should surface failed rather than silently coming back.

## Driving it

1. Connect (splash gone).
2. Stop the daemon with the run's env (`packages/pie` `tsx … daemon stop` and the run `PIE_HOME` / `PIE_DAEMON_DIR` / `PIE_DAEMON_COMPATIBILITY_KEY`).
3. Overlay first shows **Reconnecting…** for several seconds, then **The local server stopped**, the failed subtitle, **Quit**, and **Retry**.
4. Start the same isolated daemon again (export `PIE_PORT` to the recorded port — bare `daemon start` in `NODE_ENV=development` may pick an ephemeral port). Click **Retry**; overlay hides.

e2e already covers kill/respawn. Prefer that for "does overlay exist"; use a real window when you change the copy or Retry/Quit wiring.
