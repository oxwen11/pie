# Pie

Web UI and Electron app for the local Pi coding agent. TypeScript, pnpm, Turborepo.

## Core principles

- Use the simplest solution that meets current needs; keep changes focused.
- Design and review by **cost of correction**: consider users, callers, existing
  data, and recovery, not just editing code. Keep reversible choices simple;
  confirm costly-to-reverse decisions with the Developer before implementation.
- **Security is a mandatory review gate**, regardless of correction cost. Never
  trade away correctness or data integrity; unverified required behavior is not a pass.
- Follow Developer-selected patterns and documented best practices. Agent discretion
  applies to genuinely open choices, not silently discarding agreed directions.

## Workflow — start with the current stage

Read the matching stage, then the topics affected by the task. Follow relevant
links for detail; do not preload the whole rules or skills directory. Revisit the
applicable guidance when the scope changes.

| Stage                                                            | Entry point                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| Design: requirements, decisions, and implementation approach     | [design.md](.agents/rules/workflows/design.md)         |
| Review: correctness, security, compatibility, and best practices | [review.md](.agents/rules/workflows/review.md)         |
| Acceptance: checks, failure cases, and evidence                  | [acceptance.md](.agents/rules/workflows/acceptance.md) |
| Delivery: work slices, PRs, CI, and merging                      | [delivery.md](.agents/rules/workflows/delivery.md)     |

## Topics — read when affected

| Concern                                                    | Guidance                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Package boundaries, contracts, or session ownership        | [Architecture](.agents/rules/topics/architecture.md)                                                 |
| Host writes, data formats, compatibility, or migration     | [Persistence](.agents/rules/topics/persistence.md), before proposing a plan                          |
| Trust boundaries, permissions, untrusted input, or secrets | [Security](.agents/rules/topics/security.md)                                                         |
| UI composition, styling, accessibility, state, or routing  | [Components](.agents/rules/topics/ui-components.md), [state](.agents/rules/topics/frontend-state.md) |
| Effect, RPC, or runtime integration                        | [Runtime stack](.agents/rules/topics/runtime.md)                                                     |
| CLI behavior                                               | [CLI](.agents/rules/topics/cli.md)                                                                   |
| Build, lint, tests, dependencies, or dev setup             | [Toolchain](.agents/rules/topics/toolchain.md)                                                       |
| Desktop implementation                                     | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md), before touching `apps/desktop/src`                 |

Read [CONTEXT.md](CONTEXT.md) before naming session-domain concepts.
[docs/README.md](docs/README.md) indexes decisions, proposals, operational guides,
and documentation lifecycle; use it to locate relevant ADRs/RFCs. Remediation tickets live in `todos/`.
