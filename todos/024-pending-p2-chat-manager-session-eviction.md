---
status: pending
priority: p2
issue_id: "024"
tags: [performance, session, chat-runtime]
dependencies: []
---

# ChatManager retains per-session subscriptions without bound

## Problem Statement

`ChatManager.chatFor()` is get-or-create; sessions survive route navigation. Each visited session keeps a per-session `subscribe` stream and Zustand store until the server emits `closed` (archive/delete).

Users who browse many sessions may accumulate unbounded WebSocket streams and memory.

## Findings

- `apps/app/src/features/chat/runtime/chat-manager.ts` — eviction only on `#evict` from `onTerminated`
- `Chat.dispose()` unsubscribes transport but is only called from eviction
- Intentional: transcript survives navigation for fast re-mount
- No LRU, no idle timeout, no max cache size

## Proposed Solutions

### Option A: LRU eviction with store retention (Recommended)

Cap live subscriptions (e.g. 5–10); evict oldest idle Chat's transport but keep store until explicit close or memory pressure.

### Option B: Dispose transport on route leave, re-subscribe on return

Lighter memory; re-attach cost on every revisit.

### Option C: Document-only limit

Accept trade-off for desktop single-user; add metrics first.

## Acceptance Criteria

- [ ] Bounded number of concurrent per-session subscriptions (configurable constant)
- [ ] Re-opening an evicted session re-attaches cleanly via existing snapshot path
- [ ] Tests cover eviction + re-attach
- [ ] No regression to terminal error display on archived/deleted sessions

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-08-23 | Identified via session state architecture review | `#evict` deliberately keeps store for terminal error UX |
