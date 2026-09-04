# pie

In-browser tooling for the Pi coding agent: a web chat UI over local `pi`,
served by a local Node daemon and also shipped as an Electron app. pnpm +
Turborepo, TypeScript everywhere.

## Commands

Run workspace tasks through turbo, not `pnpm --filter <pkg> <task>`: `build`,
`typecheck`, and `lint:check` declare turbo `dependsOn`, so bypassing turbo
skips the upstream tsdown build (including the oxlint plugins). `pnpm test`
is the root Vitest workspace (`vitest.config.mts` → each package config).

|                                 |                                                           |
| ------------------------------- | --------------------------------------------------------- |
| `pnpm test`                     | root Vitest projects; scope with `pnpm test -- -p server` |
| `pnpm typecheck` / `pnpm build` | scope with `turbo run typecheck --filter=@getpie/server`  |
| `pnpm check`                    | lint:check + format:check + typecheck — **no tests**      |
| `pnpm lint` / `pnpm format`     | rewrite files; the `:check` variants only report          |

`format` is root-only (oxfmt) and not a turbo task. `test` is the root
Vitest workspace, not a turbo task. `lint` / `lint:check` go through turbo
so they wait on `@getpie/oxlint#build` (the oxlint tsdown plugins).
`typecheck` is cached, so re-run with `--force` after changing something
outside its hash inputs. `pnpm clean` runs `turbo run clean` then
`git clean -xdf node_modules dist .turbo` — not a repo-wide `git clean -xdf`.
Runtime UI checks use `pnpm exec pie-verify web|cli|desktop` (`@getpie/verify`).
Skill recipes live in `.agents/skills/verify-pie{,-cli,-desktop}`
(`.cursor/skills/…` are symlinks). `.agents/skills/verify` is the short
two-process note.

## Rules

@.agents/rules/architecture.md
@.agents/rules/stack.md
@.agents/rules/frontend-state.md
@.agents/rules/ui-components.md
@.agents/rules/toolchain.md

`apps/desktop/src` has its own layering contract in `apps/desktop/AGENTS.md` —
read it before touching that app.

## Pull requests

Split large changes and requirements into small slices **before coding**.
Name the slices and their order first. One concern per PR — a reviewer
should not need the rest of the feature in their head. Typical seams:
contract/types → server → UI; extract → rewire → delete. Don't mix
unrelated fixes, refactors, or docs. A one-line bugfix stays one PR.

For anything that needs more than one slice, land it as a **stack** with
`gh stack` — not one giant PR, and not disconnected `gh pr create` calls.

```bash
gh stack init feat/thing       # first slice, based on main
# commit that slice
gh stack add feat/thing-ui     # next branch on top
# commit the next slice
gh stack submit --auto         # push and open/update the stacked PRs
```

`gh stack submit` is the create/update step (`--auto` when unattended).
After trunk moves: `gh stack sync` or `gh stack rebase`. Inspect with
`gh stack view`.

Use **squash merge** — one commit per PR keeps `main` readable. Merge a
stack with `gh stack merge --squash` (`--yes` unattended). Don't mix
merge-commit / rebase merges in the repo. Squash rewrites the branch tip
out of `main`'s history, so deleting the local feature branch needs
`git branch -D` — the changes are already on `main`, so it's safe.

A UI change or UI bug needs an image or short video on the GitHub issue,
PR, or comment: `gh issue|pr create|edit|comment --attach <file>` (`gh` ≥
2.99.0). Capture with `pie-verify web|desktop evidence screenshot`; do not
commit the files.

## Going deeper

- `CONTEXT.md` — glossary. Read it before naming anything in the session domain;
  it also lists the words to avoid.
- `docs/adr/` — settled decisions (component vendoring; session field ownership,
  which supersedes the older `docs/design/session-agent-design.md` on `cwd`)
- `docs/design/`, `docs/2026-*.md` — designs in flight
- `docs/wayfinder/session-streaming-refactor/map.md` — streaming decisions that
  are closed for debate
- `.agents/skills/verify` — short build/launch notes for the two-process web dev pair
- `.agents/skills/verify-pie` — web recipe; invoke `pnpm exec pie-verify web`
- `.agents/skills/verify-pie-cli` — `pie` / `pie daemon` / `pie serve` recipe; invoke `pnpm exec pie-verify cli`
- `.agents/skills/verify-pie-desktop` — Electron + token daemon recipe; invoke `pnpm exec pie-verify desktop`
- `tools/verify` — `@getpie/verify` (root `devDependency`, bin `pie-verify`) implements all three surfaces
- `.agents/skills/react-doctor` — React health check; CI fails on error-level only
- `todos/` — numbered security/perf remediation tickets
