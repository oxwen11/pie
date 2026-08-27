# Auto-merge PRs

Squash-merge PRs that cannot change product behavior. Unsure → skip. Fail closed.

Eligible only if all hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`; every CI check is `SUCCESS` (pending, skipped, missing, failed → ineligible).

Merge with `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.

## Allowed

- Docs, CI, tooling, agent rules.
- Lint/format hygiene, even in `apps/**` or `packages/*/src/**`: oxlint, oxfmt, import order, type-assertion cleanup, `satisfies`, empty-spread, lint disable comments, vendoring lint plugins under `tools/`. Diff must be mechanical — no new branches, no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no UI copy or interaction.
- Root `package.json` / lockfile only for lint/format tooling (oxlint, oxfmt, plugins).
- pkg.pr.new preview. Not npm publish.

## Never

feat / fix / perf / refactor of product behavior; desktop / Dock / sidebar; CSS / visual tweaks; runtime dep upgrades; tests that also change product control flow; `packages/ui/src/components/**` except oxfmt/import reorder.

