---
status: pending
priority: p3
issue_id: "026"
tags: [architecture, session, adr]
dependencies: [023]
---

# ADR-0002 harness overlay reconcile not implemented

## Problem Statement

ADR `docs/adr/0002-session-info-storage-floor-harness-overlay.md` defines a floor + harness overlay model for session display fields. Current implementation is fully self-owned: title from first prompt, no `getSessionInfo` reconcile, no import path for pre-existing harness sessions.

Sessions modified outside pie (terminal `--resume`, external tools) will not reflect updated titles or recency in the sidebar.

## Findings

- Pi has no session index (`getSessionInfo` unsupported) — floor is mandatory for pi
- Claude/codex adapters collapse rich metadata to `{ title, updatedAt }` but reconcile loop is not wired
- `updatedAt` / `historyAvailable` reserved in types (see todo 023)
- Optimistic draft create in `apps/app/src/routes/draft.tsx` already assumes floor ownership

## Proposed Solutions

### Option A: Implement reconcile on `session.list` with concurrency cap

Per ADR: read harness overlay, merge into storage, return reconciled summary. Bounded fan-out.

### Option B: Background reconcile job

Periodic sync for active projects; list stays fast.

### Option C: Defer until multi-harness ship

Document current pi-only reality; close ADR gap in implementation status section.

## Acceptance Criteria

- [ ] Decision recorded: implement reconcile or explicitly defer with ADR update
- [ ] If implemented: imported sessions get floor backfill from harness
- [ ] External title/summary changes eventually visible in pie sidebar
- [ ] pi-only path unchanged (floor-only)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | ADR implementation status says "fully self-owned" today |
