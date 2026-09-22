# Cost of correction

Apply during design, code review, and test acceptance. Correction cost includes
user/caller coordination, existing data, recovery, and verification — not just
editing code.

- **Design:** Keep reversible internal changes simple; refactor when needed,
  not for hypothetical requirements. Before implementing high-cost decisions
  (external contracts, storage formats, irreversible effects), confirm tradeoffs,
  compatibility, migration/recovery, and acceptance criteria with the Developer.
- **Review:** Check those agreements and concrete failure risks. Separate optional
  refactoring from blockers; confirm newly discovered high-cost decisions.
- **Acceptance:** Verify changed behavior and each high-cost risk with evidence.
  Cover compatibility, migration, and recovery where relevant. Report gaps;
  unverified required criteria are not a pass.

Never trade away correctness, security, or data integrity. The host-write gate
in [architecture.md](architecture.md) and evidence requirements in
[verify-evidence.md](verify-evidence.md) still apply. Use existing plans and
review summaries, not extra process documents.
