# Auto-merge PRs

Squash-merge only PRs that cannot change functional product behavior, except for the narrow presentation-only fixes below. Before deciding, load and apply the repository rules for every changed area, then semantically review every changed hunk in the full diff. Titles, labels, paths, and diff size never establish eligibility by themselves. Unsure → skip. Fail closed.

Eligible only if all hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`. CI is a GitHub required-check gate — do not inspect, wait on, or decide from checks.

Merge with `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.

## Allowed

- Docs, CI, tooling, agent rules.
- Lint/format hygiene, even in `apps/**` or `packages/*/src/**`: oxlint, oxfmt, import order, type-assertion cleanup, `satisfies`, empty-spread, lint disable comments, vendoring lint plugins under `tools/`. Diff must be mechanical — no new branches, no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no UI copy or interaction.
- Basic presentation-only UI fixes in `apps/app/**`; in `packages/ui/src/**`, only when component API, DOM structure, default behavior, and theme/global styles are unchanged. Examples: overflow/bleed, misalignment, truncation, native `title` or `aria-*` derived from existing values, z-index/stacking, responsive wrap/overflow, hover/focus/hit-target glitches, spacing or class tweaks that restore existing intended presentation. The agent must verify every changed hunk is presentation-only and satisfies these constraints. No new components, screens, routes, features, user-facing copy, interaction flows, hooks, state, handlers, conditions/control flow, Effect flow, RPC/schema/wire, or routing.
- Root `package.json` / lockfile only for lint/format tooling (oxlint, oxfmt, plugins).
- pkg.pr.new preview. Not npm publish.

## Never

Never exclusions override Allowed entries.

feat / new product behavior; non-presentational fix, perf, or refactor; desktop / Dock / sidebar; visual redesigns, new components, theme or brand changes; runtime dep upgrades; tests that also change product control flow.
