# Remote SSH: desktop launches a remote pie daemon over a loopback tunnel

How the Pie desktop app reaches a pie daemon on another machine. Companion to
[`2026-07-19-server-daemon-topology-design.md`](./2026-07-19-server-daemon-topology-design.md)
(local attach-or-spawn) and the T3 research in
[`research/2026-08-26-t3code-remote-ssh.md`](./research/2026-08-26-t3code-remote-ssh.md).

This replaces the placeholder link to `2026-07-19-remote-ssh-server-design.md`.

## Goal

From the desktop app, the user types `user@host` (or picks an ssh_config `Host`).
Pie starts or attaches the **remote** pie daemon, forwards its loopback port to
`127.0.0.1` on this computer, and the existing React app talks to that forwarded
endpoint with the daemon token. Disconnect closes the tunnel only.

## Non-goals (v1)

- Pairing, LAN, Tailscale, or any client that is not this desktop app.
- In-app SSH password prompts (ssh-agent / `IdentityFile` only).
- Killing the remote daemon on disconnect or on desktop quit.
- More than one live SSH tunnel at a time.
- Auto-revert to local when the tunnel dies (RPC errors; user picks Disconnect).
- Publishing `@getpie/cli` so remote `npx @getpie/cli` works everywhere — the
  runner prefers `pie` on PATH, then npx latest.

## Shape

```
 renderer  --http/ws-->  127.0.0.1:<localPort>  --ssh -L-->  127.0.0.1:<remotePort>
                                                              pie daemon
                                                              ~/.pie/daemon/daemon.pid
```

The renderer never sees a remote address. `ServerConnection` is the same
`{ httpBaseUrl, wsBaseUrl, token }` used for the local daemon.

### Package split

| Piece                                      | Owns                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `@getpie/ssh`                              | Parse/resolve target, spawn `ssh`, launch script, local forward, health wait. No Electron, no oRPC. |
| `apps/desktop/src/main/ssh/desktop-ssh.ts` | Persist saved hosts (`userData/ssh-environments.json`, `0600`), one live tunnel, `DesktopSsh` Tag.  |
| `DesktopApplication`                       | Which environment is active (`local` vs ssh id), snapshot stream, maps SSH errors out through RPC.  |
| `@getpie/app` `Platform.ssh`               | Optional; desktop host fills it. Web host omits it, so the switcher is hidden.                      |

Application code depends on the `DesktopSsh` Tag, not on `@getpie/ssh` directly.

### Launch

1. `parseSshInput` then `ssh -G` (`resolveSshInput`). Typed user/port win;
   hostname always from `-G`.
2. `ssh` stdin = generated script; remote argv `sh -l -s <stateKey>`.
3. Script `unset`s `NODE_ENV` / `PIE_*` so a desktop-dev client cannot push the
   remote into `~/.pie-dev`, bootstraps Node 24 onto PATH, writes
   `~/.pie/ssh-launch/<stateKey>/run-pie.sh`, runs `pie daemon start` (or
   `npx @getpie/cli@latest daemon start`).
4. Reads `~/.pie/daemon/daemon.pid` and prints
   `{ remotePort, token, serverKind: "daemon" }`. Local parser takes the last
   `{…}` and requires `serverKind === "daemon"`. Token fields are redacted in
   error stdout.
5. Reserve a local loopback port, `ssh -N -L` with `ExitOnForwardFailure`,
   keepalives, `BatchMode=yes`. Poll `GET /api/health` until the body is exactly
   `ok` (unauthenticated, as locally).
6. Persist host identity (not the token). Return loopback URLs + token to the
   application. Remount the app on `activeId` change (`ReadyApp` key) so
   `createAppClients` rebuilds against the new connection.

`ssh` child env is built with `extendEnv: false` after deleting pie/Electron
keys, keeping `SSH_AUTH_SOCK`.

### Disconnect and restart

- **Disconnect / switch to This computer:** close the local tunnel `Scope`. Do
  not `pie daemon stop` on the remote. Saved remotes stay, status becomes `idle`.
- **Remove:** disconnect if that id is live, then drop the persist row.
- **Desktop quit:** `DesktopSshLive` finalizer disconnects the live tunnel;
  remote daemon stays.
- **App restart:** active environment is always `local` until the user
  reconnects. Tokens are never written to disk.

### UI

Desktop sidebar: This computer, saved remotes, Add SSH host (datalist from
`~/.ssh/config` + `known_hosts`). Connecting covers the app with the status
overlay. While an SSH environment is active, local daemon restart chrome stays
hidden.

## Auth

v1: `BatchMode=yes`. Failures that look like publickey/keyboard-interactive
denials tell the user to use ssh-agent or an IdentityFile. Askpass helpers and
`SshPasswordPrompt` exist in `@getpie/ssh` for a later in-app prompt; they are
wired as `disabledLayer` today.

## Why not fold this into `SpawnServer`

The topology design wanted a later Phase 4 where "launch + tunnel" presents as
another `RunningServerProcess`. v1 does not: the local supervisor keeps owning
the local daemon, and SSH is a second `ServerConnection` the application
selects. Folding them together can wait until there is a second remote
transport.
