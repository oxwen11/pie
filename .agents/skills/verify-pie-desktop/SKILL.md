---
name: verify-pie-desktop
description: Isolated launch/doctor/drive/cleanup for Pie Desktop (Electron + token daemon). Use when proving apps/desktop at runtime.
---

# Verify pie desktop

Desktop (`apps/desktop`, `@getpie/desktop`) hosts the **same SPA** as the web app via `@getpie/app`. It does **not** use Vite 4190. Main attach-or-spawns the **same token daemon** as the CLI (`makeDaemonServerProcess`). The daemon **outlives Electron** — closing the window is not teardown.

This file is for the next agent, cold. Follow **Launch → Doctor → Drive (feature map) → Evidence → Cleanup**. Canonical path: `.agents/skills/verify-pie-desktop`. Cursor / Claude / Codex see the same tree via symlink. The helper is **`pnpm exec pie-verify desktop`** from the root-installed workspace package `@getpie/verify` (`tools/verify`, Node >= 24). Do not add skill-local TypeScript. **Not Bash. Not Bun.**

Do **not** use `.cursor/skills/verify-pie` (web) or `.cursor/skills/verify-pie-cli` (CLI-only) as the launch recipe here. Do **not** share `/tmp/pie-verify-web/current` or `$HOME/.pie` / `$HOME/.pie_*`.

## Launch

Isolated `$PIE_HOME` (daemon is `$PIE_HOME/daemon`). First spawn prefers **4000** (`reservePort(options.port ?? 4000)`). Main passes `port === 0` on the first attempt, so **`PIE_PORT` is ignored until a later pinned respawn**. Always read `address` from `daemon.pid`. CDP on **9223** via `PIE_REMOTE_DEBUG_PORT` (desktop-runtime already wires this and isolates `userData`).

```bash
pnpm exec pie-verify desktop launch
# pnpm exec pie-verify desktop launch --replace
# pnpm exec pie-verify desktop launch --replace --empty-projects  # import-flow proof only
```

A Desktop process that exits before readiness fails launch immediately, including exit code zero; its exit status and log path are reported instead of waiting for the readiness timeout.

Ready when all of these hold:

- Electron (or electron-vite) pid from the run is alive.
- `$PIE_HOME/daemon/daemon.pid` exists; `GET $address/api/health` is `ok`.
- CDP is listening on `PIE_REMOTE_DEBUG_PORT` (default **9223**), and both that listener and the renderer's HTTP origin belong to the recorded launch process tree.
- The run's agent-browser session has selected the existing renderer target and enabled its sticky pin. Initialization selects that target before pinning and never creates a replacement Electron tab.

What launch also does:

- Requires **Node >= 24** for the helpers and any CLI stop. Prepends `NVM_BIN` when nvm is present.
- Builds `@getpie/server` (and thus `@getpie/core`) when `packages/server/dist/server.mjs` is missing. Desktop `dev` depends on that artifact (`apps/desktop/turbo.json`). Main launches it as `bun --no-install packages/server/dist/server.mjs`; packaged builds use `Contents/Resources/vendor/bun` and `Contents/Resources/server/server.mjs`.
- Sets `PIE_HOME=/tmp/pie-verify-desktop/runs/<id>/pie-home`. Daemon state is `$PIE_HOME/daemon`.
- Runs `pnpm exec install-electron` in `apps/desktop` and waits for it to finish **before** starting the 90-second `daemon.pid` wait. Installer output appends to the run's `logs/electron-vite.log`. Installation failure stops launch immediately; SIGINT/SIGTERM during installation or startup enters normal failure cleanup.
- Starts `cd apps/desktop && pnpm run dev` with `PIE_PORT`, `PIE_REMOTE_DEBUG_PORT`, and `NODE_ENV=development`. The desktop script runs Electron's official `install-electron` first (downloads only when needed), then electron-vite, which injects `ELECTRON_RENDERER_URL` (renderer is often **5173**). Use this script rather than invoking electron-vite directly: Electron 44 no longer downloads its binary during dependency installation.
- Needs a display. Uses `$DISPLAY` if set; otherwise `xvfb-run` when that binary exists. Headless Linux without either **refuses**.
- Creates and registers `$PIE_HOME/workspace/verify-pie-desktop-sample` (marked `.verify-pie-desktop-scaffold`) so ordinary verification starts on a usable draft. `--empty-projects` skips registration only for import-flow proofs. The picker stays confined to `$PIE_HOME/workspace` and cannot escape through `..` or symlinks.

If **4000** is already taken, the launcher falls back to an ephemeral port — still isolated because `$PIE_HOME` is ours. Launch **refuses** a taken **9223** (CDP). Never point this run at `~/.pie` or `~/.pie_*`. Never use web 4180/4190 or CLI-verify 4182 as *this* home's ports.

`daemon.pid` contains a token. **Do not copy the token into evidence.**

## Doctor

```bash
pnpm exec pie-verify desktop doctor
```

Checks, in order:

1. Current run at `/tmp/pie-verify-desktop/current` (else refuse a live listener that is not ours).
2. Isolated `$PIE_HOME` (not `~/.pie` / `~/.pie_*`).
3. Recorded electron-vite pid is alive.
4. `daemon.pid` pid is alive; health at the **recorded address** is `ok`.
5. Ticket: anonymous **401**, bearer **200**.
6. Doctor loads this run's browser environment, verifies CDP and renderer process ownership, and checks the active target ID and origin. It prints the pinned target ID. Doctor and launch reuse never unpin or adopt a replacement; missing, ambiguous, or mismatched targets fail. For an older run without a binding, clean up and launch again.

Splash copy: `aria-label="Starting Pie"`. Failure dialog: **Pie could not start**. Overlay: **Reconnecting…**, **The local server stopped**, **Retry**, **Quit**. Window title **Pie**, `#root`. Doctor does not require the splash to have cleared — that is the window-connects feature.

## Drive

Prefer **Playwright** (`apps/desktop/e2e/`) when the change is "does the window connect / stay connected". That harness is **test mode**: `PIE_E2E=1`, fake-pi, seeded `projects.json`. Do not treat a green e2e spec as a real Import project proof.

```bash
# scripted window-connects (E2E caveat)
cd apps/desktop && pnpm e2e -- desktop-rpc.spec.ts -g "renders in the background without taking focus and connects to the server"
```

For a **real** isolated window (import, overlay, attach), drive **`agent-browser`** against the Electron CDP port. Do not curl `/json/version`. After launch you do **not** `eval` env or pass `--session` / `--cdp` on every command — launch writes session + namespace `pie-verify-desktop`, `AGENT_BROWSER_CDP`, `AGENT_BROWSER_PIN_TAB=true`, screenshots / downloads under the run, and daemon sockets under a short `/tmp/pvs-<hash>` path (Unix `sun_path` limit). Do not set Chrome launch args (they conflict with CDP). The repo shim loads that env.

```bash
pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor   # verifies the existing pinned renderer
agent-browser get title
agent-browser wait --text "verify-pie-desktop-sample"
```

`agent-browser session` must print `pie-verify-desktop`. If it prints `default`, use `pnpm exec agent-browser` or `/tmp/pie-verify-desktop/bin/agent-browser`. If both web and desktop runs are current, set `PIE_VERIFY_SURFACE=desktop`. `agent-browser skills get electron` is the install-versioned attach recipe.

Keep this run's binding throughout the proof: no `connect` to another browser, `tab new` / tab switching, or `--no-pin-tab`. A lost target requires cleanup and a fresh launch, not a fallback window.

After Doctor, selectors match `.cursor/skills/verify-pie` (same `@getpie/app`). Prefer `find` / `wait --text` over `snapshot` + `@eN`. CDP Enter still does not submit TipTap — click send. Draft send has no `aria-label`. Do not `open http://localhost:5173/` and call that desktop.

Existing e2e worth knowing:

- `desktop-rpc.spec.ts` — "renders in the background…" is the connect proof.
- `fixtures.ts` `stopDaemonFor(pieHome)` — daemon teardown. Cleanup helpers do the same job.

## Evidence

Desktop is a UI surface, so `.agents/rules/verify-evidence.md` applies: every proof needs **before/after screenshots and a video of the drive**. Skipping either makes the proof incomplete.

```bash
pnpm exec pie-verify desktop evidence init
agent-browser get title # starts recording-001.webm automatically at 60 fps
pnpm exec pie-verify desktop evidence screenshot <feature>-before
pnpm exec pie-verify desktop evidence snapshot <feature>-before
# …drive; do not call agent-browser record…
pnpm exec pie-verify desktop evidence screenshot <feature>-after
pnpm exec pie-verify desktop evidence snapshot <feature>-after
pnpm exec pie-verify desktop evidence curl
pnpm exec pie-verify desktop evidence side-effects
pnpm exec pie-verify desktop evidence pack-video <feature>
pnpm exec pie-verify desktop evidence note "<feature>.webm: what the clip shows"
pnpm exec pie-verify desktop evidence path
```

agent-browser 0.37.1 records the existing pinned renderer in place. The Verify shim starts numbered 60 fps recordings on the first browser command. Run `evidence init` before each validation to stop the current take and select the next number; do not call `record start`, `restart`, or `stop`. After the final action, `evidence pack-video <feature>` packs the current validation and compresses near-static spans. Cleanup flushes the current take before Electron exits. A green Playwright e2e run is not a substitute for the screenshots and video.

`daemon.pid` is stored **redacted**. `evidence screenshot` / `snapshot` call the mise-managed `agent-browser` internally (session `pie-verify-desktop`, `--cdp <port>`) — they do not curl `/json/version`. Drive the window with `agent-browser`, not those evidence helpers.

## Cleanup

```bash
pnpm exec pie-verify desktop cleanup
```

1. Stop and flush the automatic recording, then stop the Desktop launch process tree (installer during preparation, electron-vite afterward). **This does not stop the daemon.**
2. `pie daemon stop` with this run's `PIE_HOME` (via `tsx` CLI). If the recorded daemon pid is still alive, TERM/KILL **that pid only**.
3. Remove the run dir, the Electron `userData` temp (`pie-desktop-remote-debugging-<port>`), and the sample folder when it carries our marker.

Never `pkill` electron / pie / vite.

## Helpers

One executable for every verify skill: `pie-verify` (`@getpie/verify`, root `devDependency`). This skill uses the `desktop` surface.

| Command | Purpose |
| --- | --- |
| `pnpm exec pie-verify desktop launch` | Isolated electron-vite + daemon. Writes `agent-browser.env` and `/tmp/pie-verify-desktop/bin/agent-browser`. |
| `pnpm exec pie-verify desktop doctor` | Read-only worth-driving check (attaches CDP). |
| `pnpm exec pie-verify desktop env [--export]` | Optional dump of the same isolation the shim loads. |
| `pnpm exec agent-browser` / `agent-browser` | Repo shim: load current run, exec mise `agent-browser`. |
| `pnpm exec pie-verify desktop evidence` | `init` / `screenshot` / `snapshot` / `curl` / `side-effects` / `note` / `pack-video` / `path`. |
| `recording-<NNN>.webm` | Raw automatic 60 fps videos under `evidence path`; each `evidence init` advances the number. |
| `<feature>.webm` | Packed review video; numbered inputs remain unchanged. |
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

Parallel Desktop runs need separate `VERIFY_PIE_DESKTOP_ROOT`, `HOME`, and `PIE_REMOTE_DEBUG_PORT` values. Let Verify derive each run's socket directory; do not share a `VERIFY_PIE_AGENT_BROWSER_SOCKET_DIR` override. The same session name can be used in separate socket directories. Drive each run through its own `<root>/bin/agent-browser`, rather than a shared current-run pointer.

## Feature map

`.cursor/skills/verify-pie-desktop/features/` — start with `README.md`.

## Sibling surfaces

- **Web** — `.cursor/skills/verify-pie`.
- **CLI** — `.cursor/skills/verify-pie-cli`.
