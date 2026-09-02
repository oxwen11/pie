---
name: verify-pie-desktop
description: Isolated launch/doctor/drive/cleanup for Pie Desktop (Electron + token daemon). Use when proving apps/desktop at runtime.
---

# Verify pie desktop

Desktop (`apps/desktop`, `@getpie/desktop`) hosts the **same SPA** as the web app via `@getpie/app`. It does **not** use Vite 4190. Main attach-or-spawns the **same token daemon** as the CLI (`makeDaemonServerProcess`). The daemon **outlives Electron** — closing the window is not teardown.

This file is for the next agent, cold. Follow **Launch → Doctor → Drive (feature map) → Evidence → Cleanup**. Canonical path: `.agents/skills/verify-pie-desktop`. Cursor / Claude / Codex see the same tree via symlink. The helper is **`pnpm exec pie-verify desktop`** from the root-installed workspace package `@getpie/verify` (`tools/verify`, Node >= 24). Do not add skill-local TypeScript. **Not Bash. Not Bun.**

Do **not** use `.cursor/skills/verify-pie` (web) or `.cursor/skills/verify-pie-cli` (CLI-only) as the launch recipe here. Do **not** share `/tmp/pie-verify-web/current` or `$HOME/.pie` / `$HOME/.pie-dev`.

## Launch

Isolated `$PIE_HOME` + `$PIE_DAEMON_DIR`. First spawn prefers **4000** (`reservePort(options.port ?? 4000)`). Main passes `port === 0` on the first attempt, so **`PIE_PORT` is ignored until a later pinned respawn**. Always read `address` from `daemon.pid`. CDP on **9223** via `PIE_REMOTE_DEBUG_PORT` (desktop-runtime already wires this and isolates `userData`).

```bash
pnpm exec pie-verify desktop launch
# pnpm exec pie-verify desktop launch --replace
```

Ready when all of these hold:

- Electron (or electron-vite) pid from the run is alive.
- `$PIE_DAEMON_DIR/daemon.pid` exists; `GET $address/api/health` is `ok`.
- Chromium CDP is listening on **9223** (launch waits on that port). Doctor then attaches internally (`agent-browser --session pie-verify-desktop connect 9223`).

What launch also does:

- Requires **Node >= 24** for the helpers and any CLI stop. Prepends `NVM_BIN` when nvm is present.
- Builds `@getpie/server` (and thus `@getpie/core`) when `packages/server/dist/server.mjs` is missing. Desktop `dev` depends on that artifact (`apps/desktop/turbo.json`). Main's `serverArgv` is `[electron, packages/server/dist/server.mjs]` with `ELECTRON_RUN_AS_NODE=1`.
- Sets `PIE_HOME=/tmp/pie-verify-desktop/runs/<id>/pie-home` and `PIE_DAEMON_DIR=$PIE_HOME/daemon`.
- Starts `cd apps/desktop && pnpm exec electron-vite dev` with `PIE_PORT`, `PIE_REMOTE_DEBUG_PORT`, and `NODE_ENV=development`. electron-vite injects `ELECTRON_RENDERER_URL` (renderer is often **5173**).
- Needs a display. Uses `$DISPLAY` if set; otherwise `xvfb-run` when that binary exists. Headless Linux without either **refuses**.
- Creates `$HOME/verify-pie-desktop-sample` (marked `.verify-pie-desktop-scaffold`) for Import project.

If **4000** is already taken, the launcher falls back to an ephemeral port — still isolated because `$PIE_DAEMON_DIR` is ours. Launch **refuses** a taken **9223** (CDP). Never point this run at `~/.pie` or a live user `PIE_DAEMON_DIR`. Never use web 4180/4190 or CLI-verify 4182 as *this* home's ports.

`daemon.pid` contains a token. **Do not copy the token into evidence.**

## Doctor

```bash
pnpm exec pie-verify desktop doctor
```

Checks, in order:

1. Current run at `/tmp/pie-verify-desktop/current` (else refuse a live listener that is not ours).
2. Isolated `$PIE_HOME` (not `~/.pie` / `~/.pie-dev`).
3. Recorded electron-vite pid is alive.
4. `daemon.pid` pid is alive; health at the **recorded address** is `ok`.
5. Ticket: anonymous **401**, bearer **200**.
6. Doctor attaches agent-browser to CDP (session `pie-verify-desktop`). That session is **not** `pie-verify-web`. Override with `VERIFY_PIE_DESKTOP_BROWSER_SESSION` if needed. After `env --export`, `"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" get title` / `get url` work.

Splash copy: `aria-label="Starting Pie"`. Failure dialog: **Pie could not start**. Overlay: **Reconnecting…**, **The local server stopped**, **Retry**, **Quit**. Window title **Pie**, `#root`. Doctor does not require the splash to have cleared — that is the window-connects feature.

## Drive

Prefer **Playwright** (`apps/desktop/e2e/`) when the change is "does the window connect / stay connected". That harness is **test mode**: `PIE_E2E=1`, fake-pi, seeded `projects.json`. Do not treat a green e2e spec as a real Import project proof.

```bash
# scripted window-connects (E2E caveat)
cd apps/desktop && pnpm e2e -- desktop-rpc.spec.ts -g "renders in the background without taking focus and connects to the server"
```

For a **real** isolated window (import, overlay, attach), drive **agent-browser** against the Electron CDP port. Do not curl `/json/version`. Do not treat `pie-verify desktop browser snapshot` as the recipe — that wrapper only prepends `--session` and `--cdp`.

```bash
pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor   # attaches session pie-verify-desktop to CDP
eval "$(pnpm exec pie-verify desktop env --export)"
# same lines are also written to /tmp/pie-verify-desktop/current/agent-browser.env

# if doctor did not run:
"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" --cdp "$AGENT_BROWSER_CDP" \
  connect "$AGENT_BROWSER_CDP"

"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" get title
"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" wait --text "Import your first project"
"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" find role button --name "Import project" click
```

`env --export` prints `AGENT_BROWSER` (mise binary), `AGENT_BROWSER_SESSION` (`pie-verify-desktop`), and `AGENT_BROWSER_CDP` (usually `9223`). After `eval`, `"$AGENT_BROWSER" skills get electron` is the install-versioned attach recipe.

After connect, selectors match `.cursor/skills/verify-pie` (same `@getpie/app`). Prefer `find` / `wait --text` over `snapshot` + `@eN`. CDP Enter still does not submit TipTap — click send. Draft send has no `aria-label`. Do not `open http://localhost:5173/` and call that desktop.

Existing e2e worth knowing:

- `desktop-rpc.spec.ts` — "renders in the background…" is the connect proof.
- `fixtures.ts` `stopDaemonFor(pieHome)` — daemon teardown. Cleanup helpers do the same job.

## Evidence

```bash
pnpm exec pie-verify desktop evidence init
pnpm exec pie-verify desktop evidence screenshot <name>
pnpm exec pie-verify desktop evidence snapshot <name>
pnpm exec pie-verify desktop evidence curl
pnpm exec pie-verify desktop evidence side-effects
pnpm exec pie-verify desktop evidence note "…"
pnpm exec pie-verify desktop evidence path
```

`daemon.pid` is stored **redacted**. `evidence screenshot` / `snapshot` call the mise-managed `agent-browser` internally (session `pie-verify-desktop`, `--cdp <port>`) — they do not curl `/json/version`. Drive the window with `$AGENT_BROWSER` after `env`, not those evidence helpers.

## Cleanup

```bash
pnpm exec pie-verify desktop cleanup
```

1. Kill the recorded electron-vite process tree (TERM then KILL). **This does not stop the daemon.**
2. `pie daemon stop` with this run's `PIE_HOME` / `PIE_DAEMON_DIR` (via `tsx` CLI). If the recorded daemon pid is still alive, TERM/KILL **that pid only**.
3. Remove the run dir, the Electron `userData` temp (`pie-desktop-remote-debugging-<port>`), and the sample folder when it carries our marker.

Never `pkill` electron / pie / vite.

## Helpers

One executable for every verify skill: `pie-verify` (`@getpie/verify`, root `devDependency`). This skill uses the `desktop` surface.

| Command | Purpose |
| --- | --- |
| `pnpm exec pie-verify desktop launch` | Isolated electron-vite + daemon. `--replace` cleans ours first. Writes `agent-browser.env`. |
| `pnpm exec pie-verify desktop doctor` | Read-only worth-driving check (attaches CDP). |
| `pnpm exec pie-verify desktop env [--export]` | Isolation for agent-browser (`AGENT_BROWSER`, session, CDP port). |
| `pnpm exec pie-verify desktop browser` | Thin exec forward (`--session` + `--cdp`). Prefer `$AGENT_BROWSER` after `env`. |
| `pnpm exec pie-verify desktop evidence` | `init` / `screenshot` / `snapshot` / `curl` / `side-effects` / `note` / `path`. |
| `pnpm exec pie-verify desktop cleanup` | Stop Electron, then the daemon; keep evidence. |

## Isolate

| Resource | Shared? |
| --- | --- |
| `$PIE_HOME` | Isolated under `/tmp/pie-verify-desktop/runs/<id>/pie-home`. |
| Daemon port | Prefers **4000** on first spawn. Read `daemon.pid`. Isolated home, not a shared `~/.pie` daemon. |
| CDP 9223 | Default `PIE_REMOTE_DEBUG_PORT`. |
| Renderer 5173 | electron-vite default. Do not point a browser at it and call that desktop. |
| Web 4180/4190 | **Do not touch.** |
| CLI verify 4182 | **Do not touch.** |
| User daemon 4000 | **Do not touch.** |

## Feature map

`.cursor/skills/verify-pie-desktop/features/` — start with `README.md`.

## Sibling surfaces

- **Web** — `.cursor/skills/verify-pie`.
- **CLI** — `.cursor/skills/verify-pie-cli`.
