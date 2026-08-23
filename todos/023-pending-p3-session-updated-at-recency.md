---
status: pending
priority: p3
issue_id: "023"
tags: [session, metadata, ux]
dependencies: []
---

# `updatedAt` and `historyAvailable` are reserved but unused

## Problem Statement

`Session.updatedAt` and `Session.historyAvailable` exist in types and list responses but are not written by the server. Session list sorts by `createdAt` only; users cannot see or sort by recency of activity.

## Findings

- `packages/server/src/types/index.ts` — fields marked "Reserved — not written yet"
- `session-service.ts` list returns `historyAvailable: metadata.historyAvailable ?? true` (always true)
- ADR-0002 defers harness overlay reconcile for `updatedAt` and transcript existence checks
- Sidebar shows title only; no "last active" timestamp

## Proposed Solutions

### Option A: Write `updatedAt` on metadata mutations (Recommended first step)

Stamp `updatedAt` on prompt, rename, archive, title derivation — no harness overlay yet.

### Option B: Full ADR-0002 overlay reconcile

Periodic or on-list refresh from harness `getSessionInfo` for claude/codex; pi stays floor-only.

### Option C: UI-only relative time from `createdAt`

Low value until `updatedAt` is real.

## Acceptance Criteria

- [ ] `updatedAt` written on meaningful session mutations
- [ ] List sort option or display uses recency (product decision)
- [ ] `historyAvailable` reflects real transcript probe (can be separate follow-up)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | ADR-0002 describes floor+overlay; implementation is fully self-owned today |
