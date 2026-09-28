# Review

- Compare the full change with requirements, agreed decisions, and relevant topic
  rules. Trace affected callers, existing data, failure paths, and regression risks.
- Assess security impact on every change; apply [security.md](../topics/security.md) to
  affected boundaries. Low correction cost does not excuse a security defect.
- Check compatibility and migration/recovery where relevant. Confirm newly
  discovered costly-to-reverse decisions with the Developer.
- Review Developer-selected patterns and best practices as well as behavior.
  Separate optional improvements from blockers: blocking findings need a concrete
  failure, security risk, compatibility cost, unmet requirement, or tool constraint.
- Check that tests assert changed behavior and that [acceptance](acceptance.md)
  covers the identified risks. Missing evidence is not proof of correctness.
- Keep public interfaces focused and remove unused wrappers left by this change.
  Cite automated diagnostics rather than copying lint rules into the review.
  Discuss a bad rule instead of suppressing checks just to pass.

For a request to review **and merge**, first follow
[review-and-merge-pr.md](review-and-merge-pr.md), including its CI-first ordering
and authorized scope. This guide does not grant merge permission.
