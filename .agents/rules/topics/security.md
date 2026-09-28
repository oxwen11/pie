# Security

Security is a mandatory part of design, review, and acceptance, regardless of
how cheaply the code could be corrected. Apply the checks to affected boundaries;
do not turn unrelated tasks into a product-wide security audit.

## Review affected boundaries

- Trace untrusted data from requests, repositories, files, remote peers, and tool
  output to privileged operations. Validate at the receiving boundary; types and
  client-side validation alone do not establish trust.
- Check authentication and authorization for the operation **and** its target.
  Preserve Project/Session isolation and least privilege; knowing an id is not
  permission to access it.
- For file access, enforce the intended roots and account for traversal and
  symlinks. For process execution, keep data separate from shell syntax and check
  how the invoked program interprets arguments. Follow the host-write approval
  gate in [persistence.md](persistence.md).
- Keep credentials and sensitive content out of unauthorized responses, logs,
  telemetry, commits, and evidence uploads. Do not weaken transport/origin checks
  or expose an authenticated local service through an unprotected route.
- On validation, authorization, or dependency failure, do not fall back to broader
  access or silently perform a partial destructive operation.

## Acceptance

Verify relevant unauthorized, malformed, cross-scope, and failure cases, not just
successful access. Record the affected boundary, expected denial/safe outcome,
and observed result using the existing review or acceptance summary.
Unresolved security defects or unverified required security behavior block
acceptance. Fix or escalate them; do not lower checks to make a change pass.
