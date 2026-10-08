---
name: verify-pie-cli
description: Isolated launch/doctor/drive/cleanup for the Pie CLI and its daemon (`packages/pie`). Use when proving pie / pie daemon at runtime.
---

# Verify pie CLI

The CLI (`packages/pie`, package `@getpie/cli`, bin `pie`) is a **different front door** from the Vite web UI. Bare `pie`, `pie daemon`, and `pie daemon start` attach-or-spawn a **detached daemon** that outlives the CLI process. There is no foreground server command; `.cursor/skills/verify-pie` runs the server entry directly (`packages/pie && pnpm dev`).

This file is for the next agent, cold. Follow **Launch → Doctor → Drive (feature map) → Evidence → Cleanup**. Canonical path: `.agents/skills/verify-pie-cli`. Cursor / Claude / Codex see the same tree via symlink (`.cursor/skills/verify-pie-cli`, …). The helper is **`pnpm exec pie-verify cli`** from the root-installed workspace package `@getpie/verify` (`tools/verify`, Node >= 24). **Not Bash.** The helper is Node 24. Source pie is Node: `node --experimental-transform-types --disable-warning=ExperimentalWarning --import ../../tools/node/register-ts-hook.mjs src/node/cli.ts` from `packages/pie`. Not `@getpie/cli` (that is `packages/pie`, bin `pie`).

Do **not** use `.cursor/skills/verify-pie` (web 4180/4190) or `.cursor/skills/verify-pie-desktop` (Electron) for CLI proofs. Do **not** share `/tmp/pie-verify-web/current` or `$HOME/.pie` / `$HOME/.pie_*`.

## Launch

Isolated `$PIE_HOME` (daemon is `$PIE_HOME/daemon`). Default daemon port **4182** (not 4000, not web 4180).

```bash
pnpm exec pie-verify cli launch
# idempotent if the current run is healthy
# pnpm exec pie-verify cli launch --replace
```

Ready when `GET $address/api/health` returns `ok`. **Read `address` from `$PIE_HOME/daemon/daemon.pid`** — do not guess the port. Preferred port is 4182; if it is taken the launcher refuses rather than silently moving.

What launch also does:

- Requires **Node >= 24**. Uses `nvm use 24` when nvm is present, and prepends `NVM_BIN` so a leftover `/exec-daemon/node` (Node 22) does not win.
- Builds `@getpie/core` via `turbo run build --filter=@getpie/core` when `packages/core/dist/compatibility.js` is missing.
- Sets `PIE_HOME=/tmp/pie-verify-cli/runs/<id>/pie-home`. Daemon state is `$PIE_HOME/daemon`.
- Invokes source: `cd packages/pie && node --experimental-transform-types --disable-warning=ExperimentalWarning --import ../../tools/node/register-ts-hook.mjs src/node/cli.ts …`. After a CLI build, `node dist/cli.js` is equivalent — do not assume `dist/cli.js` exists.
- Sets `PIE_DAEMON_COMPATIBILITY_KEY` from `@getpie/core/compatibility` `resolveDaemonCompatibilityKey()`. tsdown injects that into `dist/cli.js`; **the source runner does not**. Daemon start throws without `githash:<8-hex>`. The key is not a secret.
- Launch runs **daemon start**. The CLI process exits; the daemon stays. Cleanup is `pie daemon stop` with the **same** `PIE_HOME`, not killing the short-lived CLI pid.

Never `PIE_PORT=4000` (user / desktop daemon). Never `4180` / `4190` (web verify). If 4182 is already taken by a process this skill did not start, launch **refuses**.

Stdout you should see:

- start: `pie daemon started at http://127.0.0.1:<port> (pid N)`
- reuse: `pie daemon already running at …`
- status: `pie daemon running at …` or `pie daemon is not running`
- stop: `pie daemon stopped`

`$PIE_HOME/daemon/daemon.pid` is `{ pid, address, token, startedAt, compatibilityKey }` mode `0600`. **The token is a secret. Do not copy it into evidence, notes, or PR bodies.**

## Doctor

Read-only. Run before driving, and again after any stop/start.

```bash
pnpm exec pie-verify cli doctor
```

It checks, in order:

1. A current run pointer exists at `/tmp/pie-verify-cli/current` (else: a live 4182 without that pointer is a **foreign** daemon — refuse).
2. `$PIE_HOME` is the isolated run directory, not `~/.pie` / `~/.pie_*`.
3. `daemon.pid` exists, recorded pid is alive, `GET $address/api/health` is `ok`.
4. `POST $address/api/ws-ticket` is **401** without `Authorization`, **200** with `Authorization: Bearer <token>` from the live record (token is not printed).

**401 on health** never happens — health is unauthenticated. **200 on ticket without a token** means you hit a tokenless dev server, not the daemon.

## Drive

Harness: the CLI itself plus `curl`. **No browser** — 4182 is the daemon/API, not the Vite SPA. Do not `pie-verify cli env`. UI proofs: `pie-verify web launch` or `pie-verify desktop launch`, then `agent-browser`.

```bash
pnpm exec pie-verify cli run daemon status
pnpm exec pie-verify cli run --help
```

`pie-verify cli run` injects the current run's `PIE_HOME` / `PIE_PORT` and runs the source CLI under Node with the remaining args. Do not call a global `pie` — it may point at another home.

Commands:

| argv | Effect |
| --- | --- |
| *(empty)* / `daemon` / `daemon start` | attach-or-spawn |
| `daemon status` | print running address + pid, or not running |
| `daemon stop` | stop + write `daemon.stopped` tombstone (no auto-resurrect) |
| `--port` / `--cors-origin` / `--allowed-host` | daemon listen flags |

A second `daemon start` against the same isolated home must print `already running` and keep the same pid. `--port` on a reuse is ignored (CLI prints a note).

Do not `pie daemon stop` against `~/.pie` / a live user daemon. Only the run helper.

## Evidence

```bash
pnpm exec pie-verify cli evidence init
pnpm exec pie-verify cli evidence curl
pnpm exec pie-verify cli evidence note "…"
pnpm exec pie-verify cli evidence path
```

Evidence lands in `.cursor/skills/verify-pie-cli/evidence/<run-id>/` (gitignored except `.gitignore`). `daemon.pid` is copied **with `token` stripped**. Never paste a raw record into chat.

## Cleanup

```bash
pnpm exec pie-verify cli cleanup
```

`pie daemon stop` with this run's env, then TERM/KILL only the **recorded daemon pid** if it is still alive. Removes `/tmp/pie-verify-cli/runs/<id>`. Does **not** delete evidence. Does **not** `pkill` pie / node / bun.

## Helpers

One executable for every verify skill: `pie-verify` (`@getpie/verify`, root `devDependency`). This skill uses the `cli` surface.

| Command | Purpose |
| --- | --- |
| `pnpm exec pie-verify cli launch` | Isolated daemon. `--replace` cleans ours first. |
| `pnpm exec pie-verify cli doctor` | Read-only worth-driving check. |
| `pnpm exec pie-verify cli run` | CLI with the current run's env. |
| `pnpm exec pie-verify cli evidence` | `init` / `curl` / `note` / `path`. |
| `pnpm exec pie-verify cli cleanup` | Stop what we started; keep evidence. |

## Isolate

| Resource | Shared? |
| --- | --- |
| `$PIE_HOME` | Isolated under `/tmp/pie-verify-cli/runs/<id>/pie-home`. Daemon is `$PIE_HOME/daemon`. |
| Port 4182 | Default. Launch refuses a taken port. Never 4000 / 4180 / 4190. |
| Web verify 4180/4190 | **Do not touch.** |
| Desktop verify (prefers 4000) | **Do not touch.** Different `$PIE_HOME`. |
| User daemon 4000 | **Do not touch.** |

## Feature map

`.cursor/skills/verify-pie-cli/features/` — start with `README.md`.

## Sibling surfaces

- **Web** — `.cursor/skills/verify-pie` (Vite 4190 + foreground dev server 4180).
- **Desktop** — `.cursor/skills/verify-pie-desktop` (Electron + token daemon).
