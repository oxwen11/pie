# Documentation

Keep decisions and open work, not a permanent record of the work that produced them.

- **[adr/](adr/)** — Architecture Decision Records: what we decided, why, and the trade-offs.
- **[rfc/](rfc/)** — Requests for Comments: proposed changes and outstanding acceptance requirements, with only the supporting context needed to decide.
- The few operational references below stay at this level. Contributor rules remain in [AGENTS.md](../AGENTS.md) and domain vocabulary in [CONTEXT.md](../CONTEXT.md).

## Decisions

| ADR                                                              | Decision                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [0001](adr/0001-vendor-base-ui-components-from-coss-registry.md) | Vendor base UI components from the Coss registry         |
| [0002](adr/0002-session-info-storage-floor-harness-overlay.md)   | Pie owns session metadata; Pi owns conversation history  |
| [0003](adr/0003-pi-history-role-segmentation.md)                 | History and live output segment at user messages         |
| [0004](adr/0004-daemon-lifecycle-and-compatibility.md)           | One discoverable, compatible daemon per Pie home         |
| [0005](adr/0005-environment-rpc-routing.md)                      | Route RPC and isolate caches by Environment UUID         |
| [0006](adr/0006-bare-json-settings.md)                           | Bare, page-namespaced JSON for user preferences          |
| [0007](adr/0007-versioned-json-storage.md)                       | Explicit, atomic migrations for versioned records        |
| [0008](adr/0008-chat-image-capabilities.md)                      | Chat image capabilities, not arbitrary filesystem access |
| [0009](adr/0009-pi-session-runtime-and-recovery.md)              | One Pi runtime owner and one live consumption path       |
| [0010](adr/0010-github-pull-request-actions.md)                  | GitHub CLI access and host-authorized PR mutations       |

## RFCs and open work

- [CLI](rfc/pie-cli.md) — remaining session/project, Schedule, Hub, and terminal command proposals; current commands use CLI help.
- [Hub](rfc/pie-hub.md) — proposed external-event ingress; not another daemon or Schedule store.
- [Resource monitoring](rfc/resource-monitoring.md) — one contract covering implementation differences, host-write approval, runtime acceptance, and essential source references.
- [Oversized PR diffs](rfc/pr-diff-oversized-files.md) — fallback beyond the current truncated preview.

## Operational references

- [Host persistence inventory](host-persistence.md) — owners, paths, formats, and the host-write review gate.
- [Remote access verification](remote-access-verification.md) — transport-specific proof and isolation checks.
- Runtime verification recipes: [web](../.agents/skills/verify-pie/SKILL.md), [CLI](../.agents/skills/verify-pie-cli/SKILL.md), and [Desktop](../.agents/skills/verify-pie-desktop/SKILL.md).
- [Evidence requirements](../.agents/rules/verify-evidence.md) and [numbered remediation tickets](../todos/).

## Lifecycle

1. Put a proposed change in `rfc/`; keep its design, research, and plan together rather than creating tool-specific or document-type directories.
2. When it settles, capture only lasting decisions in numbered ADRs. Keep an ADR's number stable and make amendments explicit.
3. Keep confirmed actionable work in the relevant RFC or existing `todos/`, not a completed plan with stale checkboxes. Do not turn unverified historical audit questions into a permanent backlog.
4. Delete completed or superseded process documents and unreferenced assets once their useful content is captured. Update callers and links in the same change.

**No archive directory and no scheduled archive-cleanup job.** Deleted drafts remain available in Git history. Do not recreate historical multi-agent designs as current requirements, and do not infer acceptance from a plan's date or the existence of implementation code.
