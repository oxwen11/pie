# Pie

Web UI and Electron app for the local Pi coding agent. TypeScript, pnpm, Turborepo.

## Core principles

- Use the simplest solution that meets current needs; keep changes focused.
- Leave open-ended design choices to the agent. Preferences are defaults, not
  blockers; hard constraints need a safety, correctness, compatibility, explicit
  requirement, or demonstrated tooling basis.
- Spend effort where mistakes are expensive to undo. Confirm external contracts,
  persistent formats, and irreversible effects with the Developer before implementation.
- Never trade away correctness, security, or data integrity. Verify changed
  behavior and report gaps; unverified work is not a pass.

## Read as needed

Before acting, read the guidance matching the task below. This applies to both
implementation and review. Follow relevant links for detail; do not load the
whole rules or skills directory. Read additional guidance when scope expands.

| Task                                           | Read                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Design, refactoring, review, or acceptance     | [Cost of correction](.agents/rules/cost-of-correction.md)                            |
| Product boundaries or session ownership        | [Architecture](.agents/rules/architecture.md)                                        |
| Adding or changing host writes                 | [Persistence](.agents/rules/persistence.md), before proposing a plan                 |
| Effect, RPC, or runtime integration            | [Runtime stack](.agents/rules/stack.md)                                              |
| Frontend state, routing, or React checks       | [Frontend state](.agents/rules/frontend-state.md)                                    |
| UI components or styling                       | [UI components](.agents/rules/ui-components.md)                                      |
| CLI behavior                                   | [CLI](.agents/rules/cli.md)                                                          |
| Desktop implementation                         | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md), before touching `apps/desktop/src` |
| Build, lint, tests, dependencies, or dev setup | [Toolchain](.agents/rules/toolchain.md)                                              |
| Runtime verification or UI evidence            | [Verification and evidence](.agents/rules/verify-evidence.md)                        |
| Splitting work or preparing PRs                | [Pull requests](.agents/rules/pull-requests.md), before coding multi-slice work      |
| Asked to review and merge PRs                  | [Review and merge](.agents/rules/review-and-merge-pr.md)                             |
| Naming session-domain concepts                 | [CONTEXT.md](CONTEXT.md)                                                             |
| Architectural decisions                        | [docs/adr/](docs/adr/)                                                               |
| Session streaming                              | [Streaming decisions](docs/wayfinder/session-streaming-refactor/map.md)              |

In-progress designs live in `docs/design/` and `docs/2026-*.md`; remediation tickets in `todos/`.
