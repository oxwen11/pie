# T3 Code remote SSH — how it works, what pie copies

**Date:** 2026-08-26
**Source revision:** [`pingdotgg/t3code@78f462c4`](https://github.com/pingdotgg/t3code/tree/78f462c4)
**Question:** How does T3 Code connect a desktop client to a remote host, and which parts should pie reuse?

## Executive summary

T3 Code's desktop-managed SSH path is **not** "the renderer SSHes to the host." It is:

1. Resolve the OpenSSH target (`ssh -G`).
2. Run a generated POSIX launch script over a non-interactive session (`ssh … sh -l -s`).
3. On the remote: bootstrap Node onto `PATH` for login/non-interactive shells, write a runner under `~/.t3/ssh-launch/<stateKey>/`, start or reuse `t3 serve --host 127.0.0.1`.
4. Locally: `ssh -N -L <localPort>:127.0.0.1:<remotePort>` with `ExitOnForwardFailure` and keepalives.
5. The renderer talks **only to loopback** HTTP/WS. Pairing then exchanges a one-time token for a bearer session.

Pie should copy steps 1–4 and the loopback-only client rule. It should **not** copy pairing, LAN/Tailscale environments, in-app password prompts (v1), or killing the remote server on disconnect. Local OpenSSH is optional: probe PATH, and if `ssh`/`ssh.exe` is missing, keep the local environment and do not offer launch.

## Canonical sources

- [`packages/ssh/src/command.ts`](https://github.com/pingdotgg/t3code/blob/78f462c4/packages/ssh/src/command.ts) — spawn `ssh`/`ssh.exe` directly, `ssh -G`, host spec, redaction.
- [`packages/ssh/src/tunnel.ts`](https://github.com/pingdotgg/t3code/blob/78f462c4/packages/ssh/src/tunnel.ts) — launch script, local forward, environment manager.
- [`packages/ssh/src/auth.ts`](https://github.com/pingdotgg/t3code/blob/78f462c4/packages/ssh/src/auth.ts) — askpass helper + `SshPasswordPrompt`.
- [`packages/ssh/src/config.ts`](https://github.com/pingdotgg/t3code/blob/78f462c4/packages/ssh/src/config.ts) — `~/.ssh/config` Host aliases + `known_hosts`.
- [`apps/desktop/src/ssh/DesktopSshEnvironment.ts`](https://github.com/pingdotgg/t3code/blob/78f462c4/apps/desktop/src/ssh/DesktopSshEnvironment.ts) — desktop Tag over the tunnel manager.
- [`docs/user/remote-access.md`](https://github.com/pingdotgg/t3code/blob/78f462c4/docs/user/remote-access.md) — user-facing SSH launch + pairing.

## What T3 actually does

### Target identity

A target is `{ alias, hostname, username, port }`. `alias` is the ssh_config `Host` (or a typed hostname), **not** `user@host`. `ssh -G <alias>` fills hostname/user/port; a typed username/port overlays those fields. `hostname` always comes from `-G` so a `Host` alias still matches `IdentityFile` / `ProxyJump`.

`stateKey` is the first 16 hex chars of sha256 of `alias\\0hostname\\0user\\0port`. Remote launcher state lives under `~/.t3/ssh-launch/<stateKey>/`.

The OpenSSH destination is `user@alias` (or `alias`). Putting `user@` in `alias` would produce `user@user@host`.

### Non-interactive launch

stdin is the generated script; argv is `sh -l -s <stateKey>`. The remote shell is not the user's interactive rc, so T3 bootstraps Node: Volta, asdf, mise, fnm, nodenv, nvm, plus common bin dirs. Engine range is the server package's `engines.node` (`^22.16 || ^23.11 || >=24.10`).

The runner prefers a PATH `t3`, else `npx t3@<channel>`. It starts `t3 serve --host 127.0.0.1`, records pid/port under `ssh-launch`, and prints JSON on stdout (port + pairing credential). Local parsing takes the last `{…}` object so MOTD noise is ignored.

### Local forward

`ssh -N -L local:127.0.0.1:remote` with `ExitOnForwardFailure=yes`, `ServerAliveInterval=30`, `ServerAliveCountMax=3`. The desktop polls the forwarded HTTP health endpoint. The renderer receives `http://127.0.0.1:<localPort>` / `ws://127.0.0.1:<localPort>` plus a pairing token — never a remote IP.

### Auth and lifecycle (T3-specific)

- Askpass helper + in-app password prompt when `BatchMode=no`.
- Pairing token → bearer session, shared with LAN/Tailscale environments.
- Disconnect of a **managed** remote can kill that `t3 serve`. An "external" server (already running) is left alone.
- Reconnect after an app update may rewrite the runner and restart a managed server.

## What pie should copy

| T3                                                      | Pie                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/ssh` + desktop Tag                            | `@getpie/ssh` + `DesktopSsh` in `apps/desktop/src/main/ssh/`           |
| `ssh -G`, overlay user/port, `user@alias` spec          | Same                                                                   |
| `sh -l -s` + Node PATH bootstrap                        | Same, engine **Node 24 only** (`>=24 <25`)                             |
| `~/.t3/ssh-launch/<key>/run-t3.sh`                      | `~/.pie/ssh-launch/<key>/run-pie.sh` (runner + log only)               |
| `t3 serve --host 127.0.0.1` + ssh-launch pid/port files | `pie daemon start`, then read `~/.pie/daemon/daemon.pid`               |
| Pairing token in launch JSON                            | Daemon **auth token** in `{ remotePort, token, serverKind: "daemon" }` |
| Local `ssh -N -L` + loopback client                     | Same; `/api/health` body `"ok"`, no auth                               |
| Local `ssh` / `ssh.exe` assumed present                 | Probe PATH; if missing, keep local-only and disable Add                |
| Kill managed server on disconnect                       | **Do not.** Close the local tunnel; remote daemon stays                |
| Askpass + password prompt                               | Helpers exist; v1 is `BatchMode=yes` (ssh-agent / IdentityFile)        |
| LAN / Tailscale / hosted pairing                        | Out of scope                                                           |

## What pie must not copy

- **Pairing / multi-environment catalog.** Pie v1 is one live SSH tunnel at a time, switched against the local daemon. The daemon token is the credential; it is never persisted.
- **`Path.Path` for string math.** Pie's stack rule keeps path joins on `node:path`.
- **Effect HttpClient / NetService for health + bind.** Pie already uses `fetch` for daemon liveness and `node:net` for an ephemeral loopback bind (same exemption as `daemon/port.ts`).
- **`NODE_ENV=development` over SSH.** Desktop dev would otherwise `SendEnv` the remote into `~/.pie-dev`. Strip pie/Electron keys from the ssh child env and `unset` them in the launch script.
- **Exporting `@getpie/ssh` as an electron-vite external.** Same `require`/type-stripping trap as `@getpie/server`.

## Residual T3 bugs pie should not inherit

`buildSshHostSpec` prefixes `username@` onto `alias`. That is correct only when `alias` has no user. Pie's `parseSshInput` stores the host token as `alias` and `formatSshInput` rebuilds `user@host:port` for reconnect.
