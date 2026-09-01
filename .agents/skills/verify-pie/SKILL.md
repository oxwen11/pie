---
name: verify-pie
description: Isolated launch/doctor/drive/cleanup for the Pie web chat UI (Vite 4190 + pie serve 4180) via agent-browser. Use when proving a pie UI change at runtime.
---

# Verify pie (web)

Pie's primary user surface is the **web chat SPA** in `apps/app`. A local Node server (`packages/pie` → `pie serve`) owns Projects, Sessions, and the oRPC WebSocket. Vite on **4190** proxies `/api` and `/ws/rpc` to the server on **4180**. Desktop (`apps/desktop`) is a second host of the same SPA — do not drive it with this skill; use `.cursor/skills/verify-pie-desktop`. The CLI daemon is `.cursor/skills/verify-pie-cli`.

This file is for the next agent, cold. Follow **Launch → Doctor → Drive (feature map) → Evidence → Cleanup**. Canonical path: `.agents/skills/verify-pie`. Cursor / Claude / Codex see the same tree via symlink. The helper is **`pnpm exec pie-verify web`** from the root-installed workspace package `@getpie/verify` (`tools/verify`, Node >= 24). Do not add skill-local TypeScript. **Not Bash. Not Bun** — Pie, `tsx`, `pnpm`, and the daemon are Node 24.

## Launch

Two processes, **isolated `$PIE_HOME`**, default ports. Vite is hardcoded to **4190** with `strictPort: true` (`apps/app/vite.config.ts`); a second web instance cannot sit beside the first.

```bash
pnpm exec pie-verify web launch
# idempotent if the current run is healthy
# pnpm exec pie-verify web launch --replace   # stop ours, then start
```

Ready when both answer `ok`:

```bash
curl -fsS http://127.0.0.1:4180/api/health    # pie serve (IPv4)
curl -fsS http://localhost:4190/api/health    # Vite proxy (listens on [::1]:4190)
```

Helpers wait with `node:http` and try `127.0.0.1` / `localhost` / `[::1]`. Do not use global `fetch` for 4190 — some agent runtimes reject that port (`bad port`) even when Vite is healthy. IPv4 `127.0.0.1:4190` connection-refuses here.

Server stdout also prints `pie:ready {"port":4180}` then `pie listening on http://127.0.0.1:4180`. Launch writes that log to `/tmp/pie-verify-web/runs/<id>/logs/server.log`.

**Open `http://localhost:4190/`, never 4180, and never `http://127.0.0.1:4190/`.** Vite binds `[::1]:4190` here — IPv4 4190 connection-refuses. 4180 serves `/api/*`, `/ws/rpc`, and a *built* bundle: it 503s when nothing is built or quietly shows a stale UI. `/` redirects to `/draft`.

What launch also does:

- Requires **Node >= 24** (`packages/pie` engines). Uses `nvm use 24` when nvm is present, and prepends `NVM_BIN` so a leftover `/exec-daemon/node` (Node 22) does not win.
- Builds `@getpie/core` via `turbo run build --filter=@getpie/core` when `packages/core/dist/compatibility.mjs` is missing. Other workspace packages export `src/*.ts`; this one does not.
- Sets `PIE_HOME=/tmp/pie-verify-web/runs/<id>/pie-home` so the run does not touch `~/.pie` or `~/.pie-dev`.
- Starts **foreground `pie serve`** (`cd packages/pie && pnpm dev`), not `pie` / `pie daemon`. The daemon binds **4000** and gates `/api/ws-ticket` with `PIE_AUTH_TOKEN`.
- Starts Vite (`cd apps/app && pnpm dev`) with the same `PIE_PORT`.
- Creates `$HOME/verify-pie-sample` (marked `.verify-pie-scaffold`) so Import project can pick a folder that is already in the home listing. That folder is verification scaffolding.
- Hits `http://localhost:4190/` once so TanStack Router can regenerate `routeTree.gen.ts` (the Vite plugin, not `typecheck`, writes that file).

`PIE_PORT` may be overridden for the **server** if 4180 is yours to move — export it for **both** processes. Vite's listen port cannot move without editing `vite.config.ts`. Never use **4000**.

If 4180 or 4190 is already taken by a process this skill did not start, launch **refuses**. Driving a shared instance corrupts the user's Projects/Sessions.

## Doctor

Read-only. Run before driving, and again whenever the page looks empty or disconnected.

```bash
pnpm exec pie-verify web doctor
```

It checks, in order:

1. A current run pointer exists at `/tmp/pie-verify-web/current` (else: live 4180/4190 without that pointer is a **foreign** instance — refuse).
2. Server and Vite pids from that run are alive.
3. Those pids (or their children) own 4180 and 4190.
4. Both `/api/health` endpoints return `ok`.
5. `$PIE_HOME` is the isolated run directory, not `~/.pie` / `~/.pie-dev`.
6. `POST /api/ws-ticket` through the Vite proxy returns 200. **401** means the proxy is aimed at the desktop daemon.

If the app loads but shows no projects / never connects: `lsof -nP -iTCP:4180 -sTCP:LISTEN` and compare to the doctor pids.

## Drive

Harness: `@getpie/verify` owns **agent-browser** (`pie-verify web browser`, session `pie-verify-web`). Do not `npm i -g agent-browser`, do not export `AGENT_BROWSER_SESSION`, and do not call `agent-browser` on PATH — that splits the proof across two CLIs and can steal another session.

Chrome at `/usr/local/bin/google-chrome` is used when present. First machine: `pnpm exec pie-verify web browser install` if the packaged CLI says no browser is available. Recipe docs: `pnpm exec pie-verify web browser skills get core`.

Recipe for every drive:

1. `pnpm exec pie-verify web doctor` — abort if it fails.
2. Open the **Vite** origin: `pnpm exec pie-verify web browser open` (defaults to `http://localhost:4190/`).
3. `pnpm exec pie-verify web browser snapshot` — click `@eN` refs, not coordinates. Folder rows in the import dialog may be missing from `snapshot -i` until the listing settles; use a full `snapshot` if the listbox looks empty.
4. Prefer names from this repo: `New chat`, `Import project`, `Import this folder`, `Select a project`, `Ask Pi anything...`, `Send message`, `Toggle content panel`, `Current directory` / `New worktree`, card heading `New chat`.
5. **Do not press Enter to send.** CDP Enter does not hit the TipTap submit keymap. Click the composer submit button. Shift+Enter stays in the editor (that path is real).
6. Follow the feature file you are proving. The map is the source of truth — one convenient entry point is incomplete when the file lists others.

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
pnpm exec pie-verify web evidence init
pnpm exec pie-verify web evidence snapshot before
pnpm exec pie-verify web evidence screenshot before
# …drive…
pnpm exec pie-verify web evidence snapshot after
pnpm exec pie-verify web evidence screenshot after
pnpm exec pie-verify web evidence url
pnpm exec pie-verify web evidence side-effects
pnpm exec pie-verify web evidence note "what you proved"
```

Standards:

- Exercise the real user path (sidebar / empty state / composer), not a test-only HTTP method and not a hand-edited `projects.json`.
- Capture **the action and the resulting state**, not only the last screenshot.
- Confirm side effects on disk:
  - Projects: `$PIE_HOME/storage/projects.json` — envelope `{ "version": 1, "data": [ { "id", "name", "path", "createdAt" } ] }`. `name` is the folder basename.
  - Sessions: `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` after a successful draft send. Title is the prompt text.
- Logs for a failed connect: `/tmp/pie-verify-web/runs/<id>/logs/{server,vite}.log` and `$PIE_HOME/logs/pie.log`. Copy into evidence if you cite them; cleanup deletes the run dir.
- No mocks. There is no test-mode server in this recipe. A dry-run name does not exist — if you skip `pi`, observe that skip (no `agentSessionId` in the session file, error card in the transcript).

## Cleanup

```bash
pnpm exec pie-verify web cleanup
```

Stops **only** the pids recorded for this run (process tree, TERM then KILL). Removes `/tmp/pie-verify-web/runs/<id>` and `$HOME/verify-pie-sample` when that folder carries `.verify-pie-scaffold`. Does **not** delete `.cursor/skills/verify-pie/evidence/`. Does **not** `pkill` pie, vite, or chromium.

After cleanup, confirm evidence is still at the path `pnpm exec pie-verify web evidence path` printed before teardown (or `.agents/skills/verify-pie/evidence/<run-id>/`).

## Helpers

One executable for every verify skill: `pie-verify` (`@getpie/verify`, root `devDependency`). This skill uses the `web` surface.

| Command | Purpose |
| --- | --- |
| `pnpm exec pie-verify web launch` | Isolated serve + Vite. `--replace` cleans a live run of ours first. |
| `pnpm exec pie-verify web doctor` | Read-only worth-driving check. |
| `pnpm exec pie-verify web browser` | Packaged `agent-browser` with session `pie-verify-web`. `open` defaults to `http://localhost:4190/`. |
| `pnpm exec pie-verify web evidence` | `init` / `snapshot` / `screenshot` / `url` / `side-effects` / `note` / `path`. |
| `pnpm exec pie-verify web cleanup` | Kill what we started; keep evidence. |

## Isolate

| Resource | Shared? |
| --- | --- |
| Vite 4190 | **No.** `strictPort`, IPv6 `[::1]` only. One web instance. Open `http://localhost:4190/`. |
| Server 4180 | Movable via `PIE_PORT` (both processes). Launch still refuses a taken 4180. |
| `$PIE_HOME` | Isolated per run under `/tmp/pie-verify-web/runs/<id>/pie-home`. |
| `$HOME/verify-pie-sample` | One scaffold folder; only removed if we created it. |
| Desktop daemon 4000 | **Do not touch.** Different process, token auth. |

If the user already has `pnpm dev` on 4180/4190 against `~/.pie-dev`, **stop and tell them**. Do not point this skill at that pair.

## Feature map

`.cursor/skills/verify-pie/features/` — start with `README.md`. Prove at least the feature you changed; the map lists every entry point that must still work.

## Sibling surfaces

- **Desktop Electron** — `.cursor/skills/verify-pie-desktop` (token daemon, isolated from 4180/4190).
- **CLI daemon / serve** — `.cursor/skills/verify-pie-cli` (`pie` / `pie daemon` / `pie serve`).
- **Library** — `@getpie/app` mounted by Desktop. No separate UI.
