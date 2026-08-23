---
status: pending
priority: p3
issue_id: "022"
tags: [session, cache, frontend-state]
dependencies: []
---

# Session list cache retains stale `status` after runtime closes

## Problem Statement

Server `session.list` omits `status` when no live runtime exists (`liveStatus` returns `undefined`). The client firehose patches `status.phase` on events (e.g. `turn.ended` → `idle`) but never clears `status` when the runtime is destroyed.

Result: cached rows may carry `status: { phase: "idle" }` while the authoritative list API would omit `status` entirely.

## Findings

- `packages/server/src/harness/session-manager.ts` — `liveStatus` vs `status` distinction is intentional
- `apps/app/src/features/projects/session-list-cache.ts` — patches phase on session-scoped events, no handler for runtime teardown
- `useSessionListSync` invalidates on firehose disconnect, but not on per-session close
- UI impact today is low (idle = no sidebar dot), but blocks future "last active" UX

## Proposed Solutions

### Option A: Clear status on `session.closed` collection event (Recommended)

If/when a collection event signals runtime teardown, remove `status` from the cached row.

### Option B: Refetch list row on attach/detach boundaries

Invalidate the project's list when any session runtime closes.

### Option C: Treat `idle` as absent in UI selectors

Normalize `status?.phase === "idle"` to `undefined` in selectors — cosmetic only.

## Acceptance Criteria

- [ ] Cached `SessionSummary` matches server list semantics after runtime closes
- [ ] Unit tests in `session-list-cache.test.ts` cover close/teardown
- [ ] No spurious sidebar indicators from stale phase

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | Design doc: no `closed` phase; status omitted when not live |
