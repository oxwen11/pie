---
status: pending
priority: p3
issue_id: "025"
tags: [architecture, session, documentation]
dependencies: []
---

# Dual session status layers increase complexity

## Problem Statement

Sidebar/list uses `SessionSummary.status.phase` (server, TanStack Query). Active chat uses `ChatStoreState.status` (AI SDK `ready | submitted | streaming | error`). The mapping in `chat.ts#statusFromPhase` does not include client-only `submitted`.

This is intentional but makes debugging and user-facing consistency harder.

## Findings

- `submitted` is optimistic, set in `prompt()`, never from server
- Sidebar cannot show "message sent, waiting for turn.started"
- `requires_action` maps to `streaming` in chat but shows as "running" dot in sidebar (see todo 020)
- No single doc page explains the two layers for contributors

## Proposed Solutions

### Option A: Contributor documentation (Recommended first)

Add a short section to `.agents/rules/frontend-state.md` or `CONTEXT.md` mapping phases ↔ ChatStatus ↔ UI surfaces.

### Option B: Unify sidebar phase from Chat when session is active

Active row reads live Chat store instead of list cache — more coupling.

### Option C: Expose `submitted` on wire

Probably wrong; optimistic state should stay client-local.

## Acceptance Criteria

- [ ] Documented mapping table: `SessionPhase` → sidebar → header → `ChatStatus` → composer
- [ ] Optional: dev-only debug overlay showing both values for active session
- [ ] No requirement to merge stores unless product asks for sidebar "submitted" state

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | `statusFromPhase` treats `requires_action` as streaming |
