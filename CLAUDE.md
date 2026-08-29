# pie

In-browser tooling for the Pi coding agent: a web chat UI over local `pi`,
served by a local Node daemon and also shipped as an Electron app. pnpm +
Turborepo, TypeScript everywhere.

## Commands

Run workspace tasks through turbo, not `pnpm --filter <pkg> <task>`: `build`,
`test`, `typecheck`, and `lint:check` declare turbo `dependsOn`, so bypassing
turbo skips the upstream tsdown build (including the oxlint plugins).

|                                               |                                                      |
| --------------------------------------------- | ---------------------------------------------------- |
| `pnpm test` / `pnpm typecheck` / `pnpm build` | scope with `turbo run test --filter=@getpie/server`  |
| `pnpm check`                                  | lint:check + format:check + typecheck — **no tests** |
| `pnpm lint` / `pnpm format`                   | rewrite files; the `:check` variants only report     |

`format` is root-only (oxfmt) and not a turbo task. `lint` / `lint:check` go
through turbo so they wait on `@getpie/oxlint#build` (the oxlint tsdown
plugins). `test` and `typecheck` are cached, so re-run with `--force` after
changing something outside their hash inputs. `pnpm clean` runs `turbo run clean` then
`git clean -xdf node_modules dist .turbo` — not a repo-wide `git clean -xdf`.
Runtime UI checks use `.agents/skills/verify` (launch the vite app plus server,
then drive the page).

Cloud Agent images may put `/exec-daemon/node` (currently 22) ahead of nvm on
`PATH`. This repo needs Node 24 (`mise.toml`: 24.19.0) and pnpm 11.24.0 —
prefix `$HOME/.nvm/versions/node/v24.19.0/bin` before running workspace
commands. Vite must bind IPv4 (`--host 127.0.0.1 --port 4190`); the default
`localhost` listen is IPv6-only and `127.0.0.1:4190` health checks fail.

## Rules

@.agents/rules/architecture.md
@.agents/rules/stack.md
@.agents/rules/frontend-state.md
@.agents/rules/ui-components.md
@.agents/rules/toolchain.md

`apps/desktop/src` has its own layering contract in `apps/desktop/AGENTS.md` —
read it before touching that app.

## Pull requests

Use **squash merge** — one commit per PR keeps `main` readable. Don't mix
merge-commit / rebase merges in the repo. Squash rewrites the branch tip out
of `main`'s history, so deleting the local feature branch needs `git branch -D`
— the changes are already on `main`, so it's safe.

## Going deeper

- `CONTEXT.md` — glossary. Read it before naming anything in the session domain;
  it also lists the words to avoid.
- `docs/adr/` — settled decisions (component vendoring; session field ownership,
  which supersedes the older `docs/design/session-agent-design.md` on `cwd`)
- `docs/design/`, `docs/2026-*.md` — designs in flight
- `docs/wayfinder/session-streaming-refactor/map.md` — streaming decisions that
  are closed for debate
- `.agents/skills/verify` — build, launch, and drive the app at runtime
- `.agents/skills/react-doctor` — React health check; CI fails on error-level only
- `todos/` — numbered security/perf remediation tickets
