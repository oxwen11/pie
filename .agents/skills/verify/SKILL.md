---
name: verify
description: "Build/launch/drive recipe for verifying pie web changes at runtime (two processes: vite dev + the server)"
---

# Verifying pie at runtime

## Build + launch

Web dev is **two processes**: Vite serves the app, the pie server serves the
API, and Vite proxies `/api` + `/ws/rpc` across so the browser stays
same-origin. Turborepo owns both long-running tasks; the app's package
configuration uses a `with` sidecar so filtering to `@getpie/app` still
launches `@getpie/cli#dev`. Root `pnpm dev` runs the full workspace, including
the Electron app and package watchers.

The project `mise.toml` sources `scripts/dev-env.sh` when the worktree becomes
active. That Bash script derives the scope and exports it into the current shell
before any dev command runs. Dev commands remain plain Turbo, Vite, CLI, and
Electron commands with no lifecycle wrapper. Trust the config once; re-enter the directory (or run
`eval "$(mise hook-env -s zsh)"`) after first pulling this setup.

```bash
mise trust

# From the repository root, inspect the active worktree values first.
bash scripts/dev-scope.sh --print

# Run the full workspace in the background. This is the single root-level
# development entry point.
pnpm dev
```

For non-interactive automation, use `mise exec -- pnpm dev` so the project
environment is applied without relying on an interactive shell hook.

Open the **worktree-specific app URL** printed by `--print`, not the server URL.
The server answers `/api/*` and `/ws/rpc`; the app URL serves the live Vite
bundle. Mise exports one environment before Turbo creates either task, so both
processes stay in sync. A unique app origin also gives this worktree its own
browser localStorage, preventing another worktree or the
installed app from restoring its sessions and panels into verification
screenshots.

Health check using the printed values:
`curl http://127.0.0.1:<PIE_PORT>/api/health` → `ok`, and
`curl http://localhost:<PIE_APP_PORT>/api/health` → `ok` proves the proxy.
The mise environment deliberately replaces inherited `PIE_HOME`,
`PIE_DAEMON_DIR`, and port variables. It does not override Pi session storage;
Pi already separates its session files by the child process cwd. Agents
launched from Pie inherit the installed app's values; reusing them is the data
leak this setup prevents. Use the dev-only overrides `PIE_DEV_SCOPE_OVERRIDE`,
`PIE_DEV_HOME`, `PIE_DEV_SERVER_PORT`, `PIE_DEV_APP_PORT`,
`PIE_DEV_DESKTOP_PORT`, `PIE_DEV_DESKTOP_SERVER_PORT`, `PIE_DEV_CORS_ORIGINS`, and
`PIE_DEV_ALLOWED_HOSTS` before mise activation when customization is
intentional. Ambient `PIE_CORS_ORIGINS` and `PIE_ALLOWED_HOSTS` are cleared so
an installed Pie configuration cannot widen the unauthenticated dev server.
When Web and Desktop run together, Desktop uses the printed desktop-server port
and stores its server data under the worktree home's `desktop/` namespace. This
keeps its authenticated daemon lifecycle separate from the Web foreground
server. Do not point the Web API at **4000**: that is the packaged daemon's
default port and is guarded by an auth token. If the app loads but shows no data,
check which process owns the printed proxy target first:
`lsof -nP -iTCP:<PIE_PORT> -sTCP:LISTEN`.

Restarting the server no longer reloads the browser: Vite keeps the page, the
client reconnects over the proxied WS.

Gotchas:

- The workspace dependency manager remains pnpm. Mise activates the project
  environment, Bash derives the values, and Turborepo owns dev orchestration.
  `pnpm run check` = oxlint + oxfmt + turbo typecheck;
  `pnpm run format` fixes formatting. Typecheck one package with
  `turbo run typecheck --filter=@getpie/app`.
- **TanStack Router's `routeTree.gen.ts` regenerates only when the Vite router
  plugin runs** — on app load through the Vite dev server, NOT on typecheck.
  After adding/renaming/deleting route files, hit the app URL from
  `bash scripts/dev-scope.sh --print` once before typechecking, or typecheck
  fails against the stale tree.

## Flows worth driving

- `/` redirects to `/draft` (the new-session surface: a centered composer with a
  model select; send disabled while empty).
- On `/draft`: type a prompt → send → creates a session, sends the prompt, and
  navigates to `/session/<uuid>` with the user bubble already shown and the
  assistant reply streaming in.
- Model select in the composer toolbar (Opus/Sonnet).
- `/session/<uuid>` is just transcript + composer (no header bar).

## Browser automation (agent-browser)

`agent-browser` (bun-global, 0.15.x) drives Chromium via CDP with
accessibility-tree snapshots: `agent-browser open <url>` / `snapshot` /
`click @eN` / `keyboard type <text>` / `get url`.

- It needs playwright's **chromium-headless-shell build 1208** (bundles
  playwright-core ^1.57.0). `agent-browser install` fails
  (`playwright: command not found`) — install with
  `node ~/.bun/install/global/node_modules/playwright-core/cli.js install chromium-headless-shell`.
  The download is slow (~200MB); as a stopgap a symlink
  `chromium_headless_shell-1208 -> -1228` under `~/Library/Caches/ms-playwright/`
  launches fine.
- CDP-synthesized Enter/`\n` does NOT trigger the composer's submit path — click
  the send button element instead. Shift+Enter probing works (content stays put).
