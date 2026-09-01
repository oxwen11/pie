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
Runtime UI checks use `.cursor/skills/verify-pie` (isolated launch, doctor,
drive, evidence, cleanup). `.agents/skills/verify` is the short two-process note.

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
- `.agents/skills/verify` — short build/launch notes for the two-process web dev pair
- `.cursor/skills/verify-pie` — isolated launch/doctor/drive/cleanup for the web UI
- `.cursor/skills/verify-pie-cli` — isolated `pie` / `pie daemon` / `pie serve` recipe; implementation is `tools/verify-pie-cli` (`@getpie/verify-pie-cli`)
- `.cursor/skills/verify-pie-desktop` — isolated Electron + token daemon
- `.agents/skills/react-doctor` — React health check; CI fails on error-level only
- `todos/` — numbered security/perf remediation tickets
