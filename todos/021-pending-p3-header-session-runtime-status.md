---
status: pending
priority: p3
issue_id: "021"
tags: [ux, session, header]
dependencies: []
---

# Card header does not show session runtime status

## Problem Statement

The card header (`__root.tsx` → `CardPanel`) shows session title and project name only. When a session is in `requires_action`, `running`, or `crashed`, the user must scroll the transcript to notice — especially when content panels are open.

## Findings

- Header derives `heading` from `useProjectSessionTitle()` and `supportingText` from project name
- Chat area shows errors, loaders, and agent request cards, but header is status-blind
- `SessionSummary.status` is already available in the list cache for the active session

## Proposed Solutions

### Option A: Status chip in header (Recommended)

Add a small badge next to the title when `status.phase` is not idle: "Running", "Action needed", "Error".

### Option B: Extend supportingText

Show phase in supporting line: `ProjectName · Action needed`.

## Acceptance Criteria

- [ ] Active session header reflects non-idle phases
- [ ] Idle sessions unchanged (no extra chrome)
- [ ] Consistent semantics with sidebar indicators (see todo 020)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | Header and sidebar share the same `sessionRef` seam in `__root.tsx` |
