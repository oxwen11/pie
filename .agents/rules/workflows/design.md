# Design

Before implementation:

1. Establish the required behavior, affected callers/data, and acceptance criteria.
   Read relevant topic rules from [AGENTS.md](../../../AGENTS.md), not every rule.
2. Identify costly-to-correct decisions: external contracts, stored data, or
   irreversible effects. Confirm tradeoffs, compatibility, migration/recovery,
   and acceptance criteria with the Developer. For host writes, follow
   [persistence.md](../topics/persistence.md) before proposing the plan.
3. Identify security impact. If trust boundaries, permissions, untrusted input,
   or secrets are affected, apply [security.md](../topics/security.md) during design,
   not only after implementation.
4. Prefer existing code, platform features, and installed dependencies. Follow
   Developer-selected patterns and best practices; depart from recommendations
   for a concrete task-specific reason, not just because another shape is possible.
   Keep abstractions and public exports proportional to actual consumer needs.
5. Choose focused checks for changed behavior and high-cost risks. For multi-slice
   work, name the slices and their order using [delivery.md](delivery.md).

For a low-cost change, a brief approach and verification plan suffice. Use the
existing task/plan; do not create extra process documents or speculative machinery.
