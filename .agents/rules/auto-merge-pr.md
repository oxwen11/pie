# Auto-merge PRs

Fail closed: every changed hunk must match an allowed group; any exclusion or uncertainty means skip.

## Gate

All must hold: repo `oxwen11/pie`; base `main`; author `oxwen11`; not draft; `MERGEABLE`; review is not `CHANGES_REQUESTED`. CI is GitHub's required-check gate — do not inspect, wait on, or decide from checks.

Load and apply the repository rules for changed areas, then semantically inspect every hunk. Titles, labels, paths, and diff size are insufficient.

## Route

Always read [`auto-merge/exclusions.md`](auto-merge/exclusions.md). Then read only the matching groups:

- docs, CI, tooling, agent rules, package metadata, previews → [`auto-merge/docs-tooling.md`](auto-merge/docs-tooling.md)
- lint, format, imports, type hygiene → [`auto-merge/lint-format.md`](auto-merge/lint-format.md)
- presentation-only app or shared UI → [`auto-merge/ui-presentation.md`](auto-merge/ui-presentation.md)

For mixed PRs, read every matching group.

## Merge

Use `gh pr merge <n> --squash --delete-branch` only. No merge commit, rebase merge, `--admin`, or force-push.
