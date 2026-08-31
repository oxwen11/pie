# Auto-merge PRs

Squash-merge PRs that cannot change product behavior. Unsure → skip. Fail closed.

## Merge conflict → silent exit

Check mergeability first (`gh pr view --json mergeable,mergeStateStatus`). If not `MERGEABLE` (conflict / dirty) → **stop immediately**. Do not evaluate Allowed/Never, diff, or CI. **Do not comment on the PR** — no review, no inline comments, no thread resolution.

## Eligibility

Eligible only if all hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`. CI is a GitHub required-check gate — do not inspect, wait on, or decide from checks.

Merge with `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.

## Allowed

- Docs, CI, tooling, agent rules.
- Lint/format hygiene, even in `apps/**` or `packages/*/src/**`: oxlint, oxfmt, import order, type-assertion cleanup, `satisfies`, empty-spread, lint disable comments, vendoring lint plugins under `tools/`. Diff must be mechanical — no new branches, no changed conditions / `return` / `throw` / `await` / Effect flow, no RPC / schema / wire, no UI copy or interaction.
- Root `package.json` / lockfile only for lint/format tooling (oxlint, oxfmt, plugins).
- pkg.pr.new preview. Not npm publish.

## Never

feat / fix / perf / refactor of product behavior; desktop / Dock / sidebar; CSS / visual tweaks; runtime dep upgrades; tests that also change product control flow; `packages/ui/src/components/**` except oxfmt/import reorder.

