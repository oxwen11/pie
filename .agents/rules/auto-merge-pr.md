# Auto-merge PRs

Squash-merge PRs that cannot change product behavior. Unsure → skip. Fail closed.

Eligible only if all hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`. CI is a GitHub required-check gate — do not inspect, wait on, or decide from checks.

Merge with `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.

## Allowed

- Docs, CI, tooling, agent rules.
- Lint/format hygiene, even in `apps/**` or `packages/*/src/**`: oxlint, oxfmt, import order, type-assertion cleanup, `satisfies`, empty-spread, lint disable comments, vendoring lint plugins under `tools/`. Diff must be mechanical — no new branches, no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no UI copy or interaction.
- Basic UI fixes in `apps/**` and `packages/ui/src/**`: overflow/bleed, misalignment, truncation, missing native `title` or `aria-*`, z-index/stacking, responsive wrap/overflow, hover/focus/hit-target glitches, spacing or class tweaks that restore intended presentation. No new screens, routes, features, user-facing copy, or interaction flows. Diff must not change conditions / `return` / `throw` / `await` / Effect flow, RPC / schema / wire, or add handlers / state / routing.
- Root `package.json` / lockfile only for lint/format tooling (oxlint, oxfmt, plugins).
- pkg.pr.new preview. Not npm publish.

## Never

feat / new product behavior; business-logic perf or refactor; desktop / Dock / sidebar; visual redesigns, new components, theme or brand changes; runtime dep upgrades; tests that also change product control flow.
