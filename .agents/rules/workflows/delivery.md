# Delivery

- One concern per PR. Split large work into named, ordered slices before coding.
  A small fix stays one PR; multiple slices must form a stack, not disconnected PRs.
- Use the [PR template](../../../.github/pull_request_template.md); keep it brief
  and link existing context instead of duplicating it.
- Create stacks with `gh stack init` → `gh stack add` → `gh stack submit --auto`.
  After trunk moves, use `gh stack sync` or `gh stack rebase`.
- Squash merge only (`gh stack merge --squash` for stacks). When asked to review
  and merge PRs, follow [pull-requests.md](pull-requests.md).
- UI changes require screenshots **and** video attached to the issue or PR via
  `gh issue|pr create|edit|comment --attach <file>`. Follow
  [acceptance.md](acceptance.md); never commit evidence files.
