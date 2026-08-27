# Auto-merge PRs

Squash-merge PRs that cannot change product behavior. Unsure → skip. Fail closed.

Eligible only if all hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`. CI is a GitHub required-check gate — do not inspect, wait on, or decide from checks.

Merge with `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.

## Allowed

- Docs, CI, tooling, agent rules.
- Lint/format hygiene, even in `apps/**` or `packages/*/src/**`: oxlint, oxfmt, import order, type-assertion cleanup, `satisfies`, empty-spread, lint disable comments, vendoring lint plugins under `tools/`. Diff must be mechanical — no new branches, no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no UI copy or interaction.
- Mechanical CSS/layout fixes in `apps/**`: width/overflow caps (`max-w-*`, `truncate`, `min-w-0`), margin/padding alignment or de-duplication (e.g. drop a stacked `-mx-*` when a parent row already owns the bleed), flex/grid `justify-*` / `self-*` tweaks, native `title` on truncated labels. Diff must be mechanical — no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no new UI copy, no new interactive behavior (handlers, routing, state, dropdown logic).
- Root `package.json` / lockfile only for lint/format tooling (oxlint, oxfmt, plugins).
- pkg.pr.new preview. Not npm publish.

## Never

feat / fix / perf / refactor of product behavior; desktop / Dock / sidebar; CSS / visual tweaks beyond mechanical layout fixes above (colors, themes, typography, spacing redesigns, new components); runtime dep upgrades; tests that also change product control flow; `packages/ui/src/components/**` except oxfmt/import reorder.

