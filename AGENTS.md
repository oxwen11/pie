# Pie

Web UI and Electron app for the local Pi coding agent. TypeScript, pnpm, Turborepo.

## Working principles

Use the simplest solution that meets current requirements. Spend effort in
proportion to the cost of correcting a mistake, including its impact on users,
callers, and existing data:

- **Design:** Keep reversible internal changes simple. Before implementing
  high-cost decisions (external contracts, storage formats, irreversible effects),
  confirm tradeoffs, compatibility, migration/recovery, and acceptance criteria
  with the Developer.
- **Review:** Check those agreements and concrete failure risks. Separate optional
  refactoring from blockers; confirm newly discovered high-cost decisions.
- **Acceptance:** Verify changed behavior and each high-cost risk with evidence.
  Cover compatibility, migration, and recovery where relevant. Report gaps;
  unverified required criteria are not a pass.

Never trade away correctness, security, or data integrity. Existing host-write
and verification requirements still apply; no extra process documents needed.

## Commands

| Task                                 | Command                                  |
| ------------------------------------ | ---------------------------------------- |
| Build / typecheck                    | `pnpm build` / `pnpm typecheck`          |
| Lint + format + typecheck (no tests) | `pnpm check`                             |
| Node + browser tests                 | `pnpm test`                              |
| Electron tests                       | `pnpm e2e`                               |
| Runtime verification                 | `pnpm exec pie-verify web\|cli\|desktop` |

Run build, typecheck, and lint through Turbo, including scoped runs:
`pnpm exec turbo run typecheck --filter=@getpie/server`. Do not bypass dependency
builds with `pnpm --filter <pkg> <task>`. Tests and formatting are exceptions;
see `.agents/rules/toolchain.md` for commands and caveats.

## Repository rules

@.agents/rules/architecture.md
@.agents/rules/stack.md
@.agents/rules/frontend-state.md
@.agents/rules/ui-components.md
@.agents/rules/toolchain.md
@.agents/rules/verify-evidence.md
@.agents/rules/ponytail.md
@.agents/rules/cli.md

Read `apps/desktop/AGENTS.md` before changing `apps/desktop/src`.
Read `CONTEXT.md` before naming session-domain concepts; `docs/adr/` records
settled decisions. Streaming decisions: `docs/wayfinder/session-streaming-refactor/map.md`.

## Delivery

- One concern per PR. Split large work into named, ordered slices before coding;
  use `gh stack init` → `gh stack add` → `gh stack submit --auto` for multiple
  slices. After trunk moves, use `gh stack sync` or `gh stack rebase`.
- Squash merge only (`gh stack merge --squash` for stacks). When asked to review
  and merge PRs, follow `.agents/rules/review-and-merge-pr.md`.
- UI changes require screenshots **and** video attached to the issue or PR via
  `gh issue|pr create|edit|comment --attach <file>`. Follow
  `.agents/rules/verify-evidence.md`; never commit evidence files.

## Task guides

- Runtime checks: `.agents/skills/verify-pie{,-cli,-desktop}/SKILL.md`.
  Web dev setup: `.agents/skills/verify/SKILL.md`; open `http://localhost:4190/`,
  not API port 4180 or daemon port 4000. Cloud setup: `.cursor/environment.json`.
- React checks and audits: `.agents/skills/react-doctor`, `performance`,
  `improve-react`. Run `prune-tests` only when requested.
- In-progress designs: `docs/design/`, `docs/2026-*.md`. Remediation: `todos/`.
