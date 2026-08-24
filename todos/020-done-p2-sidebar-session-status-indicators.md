---
status: done
priority: p2
issue_id: "020"
tags: [ux, session, sidebar]
dependencies: []
---

# Sidebar session status indicators are misleading

## Problem Statement

`ProjectSessionRow` uses the same green pulsing dot for `running` and `requires_action`, with a tooltip that says "A turn is running in this session". `crashed` sessions show no indicator at all.

Users cannot tell from the sidebar whether a background session is actively generating, waiting for their approval, or has failed.

## Findings

- `apps/app/src/features/projects/project-session-row.tsx` — only checks `running | requires_action`, same visual for both
- `crashed` phase is folded server-side (`session-fold.ts`) and propagated via firehose, but sidebar ignores it
- Design doc (`docs/design/session-agent-design.md` §6.7) defines four phases; UI only distinguishes two visually

## Proposed Solutions

### Option A: Distinct indicators per phase (Recommended)

| Phase              | Indicator                                                        |
| ------------------ | ---------------------------------------------------------------- |
| `running`          | Green pulse dot (current)                                        |
| `requires_action`  | Amber/orange dot or bell icon, tooltip "Waiting for your action" |
| `crashed`          | Red dot or warning icon, tooltip "Session crashed"               |
| `idle` / no status | Nothing                                                          |

### Option B: Single badge with phase label

Small text badge: "Running", "Action needed", "Error".

## Acceptance Criteria

- [x] `running` and `requires_action` are visually distinct in the sidebar
- [x] `crashed` is visible without opening the session
- [x] Tooltips match the actual phase semantics
- [x] Existing tests updated; add row-level tests if missing

## Work Log

| Date       | Action                                           | Learnings                                                            |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| 2026-08-23 | Identified via session state architecture review | Sidebar uses `SessionSummary.status.phase` from TanStack Query cache |
| 2026-08-23 | Implemented distinct phase indicators in sidebar | `sessionStatusIndicator` maps each phase to color + tooltip          |
