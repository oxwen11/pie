# Design and review by cost of correction

Spend effort where mistakes are expensive to undo: user/caller coordination,
existing data, irreversible effects, and recovery — not just editing code.

## Required

- Before implementing high-cost decisions, confirm tradeoffs, compatibility,
  migration/recovery, and acceptance criteria with the Developer. For host writes,
  follow [persistence.md](persistence.md) before proposing a plan.
- Review actual behavior, affected callers, and failure paths against the agreed
  requirements. Confirm newly discovered high-cost decisions.
- Verify changed behavior and each high-cost risk with evidence. Cover existing
  clients/data, migration, and recovery where relevant; report unverified criteria
  as incomplete. See [verify-evidence.md](verify-evidence.md).

## Engineering judgment

- Prefer existing code, platform features, and installed dependencies before
  adding machinery. Keep reversible changes simple and local.
- Follow Developer-selected patterns, including compound components for multi-part
  UI. Best-practice recommendations remain the starting point; depart for a
  concrete task-specific reason, not merely because another shape is possible.
- Keep abstractions and public exports proportional to consumer needs. Remove
  unused wrappers left by a refactor; do not build future flexibility for its own sake.
- Keep optional improvements separate from blockers. A blocking design finding
  needs a concrete failure, compatibility cost, unmet requirement, or applicable
  tool constraint — not just a preference for another implementation.
- Cite automated diagnostics rather than restating their rules. Do not weaken
  checks just to pass; propose a targeted rule change if it enforces a preference
  without a useful benefit. Use existing plans/reviews, not extra paperwork.
