---
name: verify-pie
description: Isolated launch/doctor/drive/cleanup for the Pie web chat UI (Vite 4190 + pie serve 4180) via agent-browser. Use when proving a pie UI change at runtime.
---

# Verify pie (web)

Pie's primary user surface is the **web chat SPA** in `apps/app`. A local Node server (`packages/pie` → `pie serve`) owns Projects, Sessions, and the oRPC WebSocket. Vite on **4190** proxies `/api` and `/ws/rpc` to the server on **4180**. Desktop (`apps/desktop`) is a second host of the same SPA — do not drive it with this skill; use `.cursor/skills/verify-pie-desktop`. The CLI daemon is `.cursor/skills/verify-pie-cli`.

This file is for the next agent, cold. Follow **Launch → Doctor → Drive (feature map) → Evidence → Cleanup**. Helpers are **TypeScript** in `.cursor/skills/verify-pie/src/`, started by `.cursor/skills/verify-pie/bin/verify-pie` (Node >= 24, `node --experimental-strip-types`). Shared process/HTTP/JSON code is `@getpie/verify-pie-cli/runtime` (`tools/verify-pie-cli`). **Not Bash. Not Bun** — Pie, `tsx`, `pnpm`, and the daemon are Node 24.

## Launch

Two processes, **isolated `$PIE_HOME`**, default ports. Vite is hardcoded to **4190** with `strictPort: true` (`apps/app/vite.config.ts`); a second web instance cannot sit beside the first.

```bash
.cursor/skills/verify-pie/bin/verify-pie launch
# idempotent if the current run is healthy
# .cursor/skills/verify-pie/bin/verify-pie launch --replace   # stop ours, then start
```

Ready when both answer `ok`:

```bash
curl -fsS http://127.0.0.1:4180/api/health    # pie serve (IPv4)
curl -fsS http://localhost:4190/api/health    # Vite proxy (listens on [::1]:4190)
```

Server stdout also prints `pie:ready {"port":4180}` then `pie listening on http://127.0.0.1:4180`. Launch writes that log to `/tmp/verify-pie/runs/<id>/logs/server.log`.

**Open `http://localhost:4190/`, never 4180, and never `http://127.0.0.1:4190/`.** Vite binds `[::1]:4190` here — IPv4 4190 connection-refuses. 4180 serves `/api/*`, `/ws/rpc`, and a *built* bundle: it 503s when nothing is built or quietly shows a stale UI. `/` redirects to `/draft`.

What launch also does:

- Requires **Node >= 24** (`packages/pie` engines). Uses `nvm use 24` when nvm is present, and prepends `NVM_BIN` so a leftover `/exec-daemon/node` (Node 22) does not win.
- Builds `@getpie/core` via `turbo run build --filter=@getpie/core` when `packages/core/dist/compatibility.mjs` is missing. Other workspace packages export `src/*.ts`; this one does not.
- Sets `PIE_HOME=/tmp/verify-pie/runs/<id>/pie-home` so the run does not touch `~/.pie` or `~/.pie-dev`.
- Starts **foreground `pie serve`** (`cd packages/pie && pnpm dev`), not `pie` / `pie daemon`. The daemon binds **4000** and gates `/api/ws-ticket` with `PIE_AUTH_TOKEN`.
- Starts Vite (`cd apps/app && pnpm dev`) with the same `PIE_PORT`.
- Creates `$HOME/verify-pie-sample` (marked `.verify-pie-scaffold`) so Import project can pick a folder that is already in the home listing. That folder is verification scaffolding.
- Hits `http://localhost:4190/` once so TanStack Router can regenerate `routeTree.gen.ts` (the Vite plugin, not `typecheck`, writes that file).

`PIE_PORT` may be overridden for the **server** if 4180 is yours to move — export it for **both** processes. Vite's listen port cannot move without editing `vite.config.ts`. Never use **4000**.

If 4180 or 4190 is already taken by a process this skill did not start, launch **refuses**. Driving a shared instance corrupts the user's Projects/Sessions.

## Doctor

Read-only. Run before driving, and again whenever the page looks empty or disconnected.

```bash
.cursor/skills/verify-pie/bin/verify-pie doctor
```

It checks, in order:

1. A current run pointer exists at `/tmp/verify-pie/current` (else: live 4180/4190 without that pointer is a **foreign** instance — refuse).
2. Server and Vite pids from that run are alive.
3. Those pids (or their children) own 4180 and 4190.
4. Both `/api/health` endpoints return `ok`.
5. `$PIE_HOME` is the isolated run directory, not `~/.pie` / `~/.pie-dev`.
6. `POST /api/ws-ticket` through the Vite proxy returns 200. **401** means the proxy is aimed at the desktop daemon.

If the app loads but shows no projects / never connects: `lsof -nP -iTCP:4180 -sTCP:LISTEN` and compare to the doctor pids.

## Drive

Harness: **agent-browser** (Chromium via CDP, accessibility snapshot, `@eN` refs).

```bash
# once per machine (user prefix if `npm i -g` hits EACCES on /usr/lib)
npm i -g --prefix "$HOME/.local" agent-browser
export PATH="$HOME/.local/bin:$PATH"
agent-browser install
# then
agent-browser skills get core
```

`agent-browser` 0.15.x needed a separate `playwright-core` chromium-headless-shell download. Current 0.35.x ships `agent-browser install`. Google Chrome at `/usr/local/bin/google-chrome` also works if the bundled browser is missing.

Recipe for every drive:

1. `verify-pie doctor` — abort if it fails.
2. Named session (do not use the machine-wide default browser):
   `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix verify-pie)"`
3. Open the **Vite** origin: `agent-browser open http://localhost:4190/`
4. `agent-browser snapshot` — click `@eN` refs, not coordinates. Folder rows in the import dialog may be missing from `snapshot -i` until the listing settles; use a full `snapshot` if the listbox looks empty.
5. Prefer names from this repo: `New chat`, `Import project`, `Import this folder`, `Select a project`, `Ask Pi anything...`, `Send message`, `Toggle content panel`, `Current directory` / `New worktree`, card heading `New chat`.
6. **Do not press Enter to send.** CDP Enter does not hit the TipTap submit keymap. Click the composer submit button. Shift+Enter stays in the editor (that path is real).
7. Follow the feature file you are proving. The map is the source of truth — one convenient entry point is incomplete when the file lists others.

Stable handles (from source, not guesses):

| UI | How it appears |
| --- | --- |
| Empty draft (no projects) | Heading **Import your first project**; button **Import project** |
| Sidebar new draft | **New chat** |
| Sidebar import | button name **Import project** (plus-folder on the Projects group) |
| Import dialog | textbox **Search folders or enter a full path...**; button **Import this folder**; footer shows the current path |
| Draft project picker | combobox / button **Select a project** until a project is chosen; options are folder basenames |
| Draft workspace | **Current directory** / **New worktree** (only if the folder is a git repo) |
| Draft composer | contenteditable; placeholder **Ask Pi anything...** |
| Draft send | submit control, **no aria-label** — snapshot it after typing (disabled while empty / no project) |
| Session send | button **Send message**; while streaming, **Stop generating** |
| Session heading | card title is the session title (prompt text after create) or **New chat**; supporting text is the project name |
| Content panel | **Toggle content panel** (session routes only). Empty copy: **Choose what to show alongside the chat.** Openable titles: **Files**, **Review**, **Terminal**, **Browser**. **File** is a family opened from the Files tree, not a blank first panel. |

Do not call `agent.session.create` / `project.create` over raw RPC to "skip" the UI. Those are the production procedures the page already uses; driving them from a script is not a user path. After a UI action, **do** read `$PIE_HOME` to confirm the side effect.

`pi` (the coding agent binary) is required only for assistant streaming. Session create, the user bubble, and sidebar rows must still happen if `pi` is missing — expect **Model request failed** / **Thinking…** then an error, not a missing `/session/<uuid>`.

## Evidence

Proof directory (survives cleanup):

```text
.cursor/skills/verify-pie/evidence/<run-id>/
```

```bash
.cursor/skills/verify-pie/bin/verify-pie evidence init
.cursor/skills/verify-pie/bin/verify-pie evidence snapshot before
.cursor/skills/verify-pie/bin/verify-pie evidence screenshot before
# …drive…
.cursor/skills/verify-pie/bin/verify-pie evidence snapshot after
.cursor/skills/verify-pie/bin/verify-pie evidence screenshot after
.cursor/skills/verify-pie/bin/verify-pie evidence url
.cursor/skills/verify-pie/bin/verify-pie evidence side-effects
.cursor/skills/verify-pie/bin/verify-pie evidence note "what you proved"
```

Standards:

- Exercise the real user path (sidebar / empty state / composer), not a test-only HTTP method and not a hand-edited `projects.json`.
- Capture **the action and the resulting state**, not only the last screenshot.
- Confirm side effects on disk:
  - Projects: `$PIE_HOME/storage/projects.json` — envelope `{ "version": 1, "data": [ { "id", "name", "path", "createdAt" } ] }`. `name` is the folder basename.
  - Sessions: `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` after a successful draft send. Title is the prompt text.
- Logs for a failed connect: `/tmp/verify-pie/runs/<id>/logs/{server,vite}.log` and `$PIE_HOME/logs/pie.log`. Copy into evidence if you cite them; cleanup deletes the run dir.
- No mocks. There is no test-mode server in this recipe. A dry-run name does not exist — if you skip `pi`, observe that skip (no `agentSessionId` in the session file, error card in the transcript).

## Cleanup

```bash
.cursor/skills/verify-pie/bin/verify-pie cleanup
```

Stops **only** the pids recorded for this run (process tree, TERM then KILL). Removes `/tmp/verify-pie/runs/<id>` and `$HOME/verify-pie-sample` when that folder carries `.verify-pie-scaffold`. Does **not** delete `.cursor/skills/verify-pie/evidence/`. Does **not** `pkill` pie, vite, or chromium.

After cleanup, confirm evidence is still at the path `verify-pie evidence path` printed before teardown (or `.cursor/skills/verify-pie/evidence/<run-id>/`).

## Helpers

One executable. Commands are TypeScript (`src/cli.ts`).

| Command | Purpose |
| --- | --- |
| `verify-pie launch` | Isolated serve + Vite. `--replace` cleans a live run of ours first. |
| `verify-pie doctor` | Read-only worth-driving check. |
| `verify-pie evidence` | `init` / `snapshot` / `screenshot` / `url` / `side-effects` / `note` / `path`. |
| `verify-pie cleanup` | Kill what we started; keep evidence. |

## Isolate

| Resource | Shared? |
| --- | --- |
| Vite 4190 | **No.** `strictPort`, IPv6 `[::1]` only. One web instance. Open `http://localhost:4190/`. |
| Server 4180 | Movable via `PIE_PORT` (both processes). Launch still refuses a taken 4180. |
| `$PIE_HOME` | Isolated per run under `/tmp/verify-pie/runs/<id>/pie-home`. |
| `$HOME/verify-pie-sample` | One scaffold folder; only removed if we created it. |
| Desktop daemon 4000 | **Do not touch.** Different process, token auth. |

If the user already has `pnpm dev` on 4180/4190 against `~/.pie-dev`, **stop and tell them**. Do not point this skill at that pair.

## Feature map

`.cursor/skills/verify-pie/features/` — start with `README.md`. Prove at least the feature you changed; the map lists every entry point that must still work.

## Sibling surfaces

- **Desktop Electron** — `.cursor/skills/verify-pie-desktop` (token daemon, isolated from 4180/4190).
- **CLI daemon / serve** — `.cursor/skills/verify-pie-cli` (`pie` / `pie daemon` / `pie serve`).
- **Library** — `@getpie/app` mounted by Desktop. No separate UI.
