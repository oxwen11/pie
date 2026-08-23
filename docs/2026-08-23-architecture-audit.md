# Architecture audit — 2026-08-23

Scheduled review of the **pie** monorepo against `.agents/rules/architecture.md`,
`stack.md`, `frontend-state.md`, `ui-components.md`, and `apps/desktop/AGENTS.md`.

Pie is **Pi-only**: one child process per live session, no harness registry, no
agent selection on the wire. `SessionRef` is `{ projectId, sessionId }`. The
folder `packages/server/src/harness/` is a legacy name — it holds the Pi session
domain (`PiAgent`, `PiAgentSessionManager`, `PiAgentSessionService`) and
`harness/pi/*`.

## Summary

Package boundaries are largely healthy: no `@pie/app` → `@pie/server` imports in
production SPA code, no `@pie/ui` barrel imports, desktop renderer uses root
`@pie/app` exports only, and `EventBusLayer` is a single const in
`packages/server/src/rpc/runtime.ts` (no `Layer.fresh` in production). Persistent
paths stay in `packages/server/src/config/paths.ts`; HTTP concerns stay under
`packages/server/src/http/`.

Highest-impact debt clusters in three areas:

1. **Vendored UI boundary** — hand-maintained code inside
   `packages/ui/src/components/` (Tiptap, loading `Button`, local `frame`/`kbd`).
2. **SPA feature ownership** — some content panels still live in shell layout;
   module-scope browser APIs at import time.
3. **Effect composition tests** — no behavioural test pinning shared Layer
   identity for `EventBusLayer` and the Pi session stack; some tests memoize
   stateful Layers or import private session collaborators directly.

## Open remediation (pie)

| ID | Severity | Topic | Notes |
| -- | -------- | ----- | ----- |
| pie-audit-1 | P2 | Tiptap UI in vendored `components/` tree | Move to `ai-elements/` or feature wrappers before next coss refresh |
| pie-audit-2 | P2 | Loading patch in vendored `button.tsx` | Same — `loading` prop + Spinner are owned code in registry tree |
| pie-audit-3 | P3 | Local `frame` / `kbd` in vendored tree | Same |
| pie-audit-4 | P2 | `localStorage` at `content-panel` module init | Private browsing can throw at import; guard or construct at app mount |
| pie-audit-5 | P2 | Files feature reads route identity via `useMatch` | Derive `projectId` from panel `sessionRef` at composition root |
| pie-audit-6 | P2 | Automated feature / package boundary lint | Cross-feature imports, `useMatch` in features, `@pie/server` in `apps/app` |
| pie-audit-7 | P2 | Placeholder panels in layout instead of features | `terminal`, `browser`, mock `diff` still under `content-panel/panels/` |
| pie-audit-8 | P3 | Move `Conversation` composite toward `@pie/ui` or feature | Chat-only composite in `apps/app/src/components/` |
| pie-audit-9 | P3 | Split content-panel definition ownership | Panel types should colocate with their features |
| pie-audit-10 | P2 | Composition-root behavioural tests | Pin one `EventBusLayer` + one session-manager build; reject `Layer.fresh` splits |
| pie-audit-11 | P2 | EventBus tests memoize `layer()` | Prefer `Layer.fresh` in tests that need isolation, or integration through runtime |
| pie-audit-12 | P3 | `harness/index.ts` exports too wide | Narrow public surface to Pi session roles; keep `session.ts` private |
| pie-audit-13 | P3 | `makeEventBus` exported publicly | Composition root should own bus construction |
| pie-audit-14 | P3 | `sessionId` prop vs `sessionKey` in files tree | `FileTreeAdapter` receives `sessionRefKey`, not a bare UUID |

**Addressed in open PR [#9](https://github.com/oxwen11/pie/pull/9):** pie-audit-4, pie-audit-5, pie-audit-6 (subset).

**Addressed in open PR [#10](https://github.com/oxwen11/pie/pull/10):** pie-audit-7 (mock diff → Review feature).

## Findings detail

### 1. Vendored UI tree contains owned code (P2)

`packages/ui/src/components/*` is refreshed with `shadcn add @coss/ui
--overwrite` (ADR 0001). Hand-written code at risk on the next registry pull:

- **Tiptap** — `components/tiptap/*` + `hooks/tiptap/*` (pie-audit-1)
- **Loading Button** — `components/button.tsx` adds `loading` prop and Spinner
  (pie-audit-2)
- **Frame / Kbd** — local primitives alongside vendored files (pie-audit-3)

**Fix direction:** move durable UI to `ai-elements/` or feature wrappers; revert
vendored files to registry versions on refresh.

### 2. SPA feature ownership (P2–P3)

`frontend-state.md` models chat as the reference feature: everything a feature
needs lives under `features/<name>/`.

- **Content panels** — `files` lives in `features/files/`, but terminal, browser,
  and the mock diff panel still live in `components/layout/content-panel/panels/`
  (pie-audit-7, pie-audit-9).
- **Conversation UI** — chat-only composite in `apps/app/src/components/`
  (pie-audit-8).
- **Module-scope init** — `content-panel.ts` touches `window.localStorage` at
  import; `__root.tsx` registers panels at module load (pie-audit-4).

**Fix direction:** colocate panels with features; construct `ContentPanel` at app
mount inside a provider.

### 3. Pi session domain and test boundaries (P2–P3)

`architecture.md` defines four public Pi roles; `session.ts`, `session-fold.ts`,
and `session-repository.ts` are private collaborators. There is no multi-harness
registry to narrow — only export surface and test wiring.

- **Public exports too wide** — `harness/index.ts` re-exports `executable`,
  `queue-stream`, `session-io`, etc. (pie-audit-12)
- **EventBus factory exported** — `makeEventBus` reachable outside composition
  root (pie-audit-13)
- **Test wiring** — session tests import private factories directly; prefer
  integration through `PiAgentSessionServiceLayer` (pie-audit-10)
- **Layer memoization in tests** — `events.test.ts` and session tests share
  memoized Layers (pie-audit-11)

### 4. Naming: session identity in files feature (P3)

`FileTreeAdapter` prop is named `sessionId` but receives `sessionRefKey(...)` —
a composite key, not a bare UUID (pie-audit-14).

### 5. Desktop daemon imports (intentional)

`apps/desktop/src/main/server/daemon-server-process.ts` imports
`@pie/server/daemon` for PID files and stop semantics. This is Main-process server
supervision, not renderer leakage — consistent with `apps/desktop/AGENTS.md`
(server platform adapters at the composition root).

## What looks clean

- **Import graph:** `contract ← server ← cli|desktop` and
  `contract ← client ← app ← desktop` respected in production code.
- **Pi-only wire model:** no `harnessAgentId`, no agent registry RPC, session
  router under `agent.session`.
- **Feature cross-imports:** none detected across `apps/app/src/features/` at
  audit time.
- **Query keys:** cache writers use `queryOptions(...).queryKey`; `.key()` only
  for invalidation.
- **Desktop renderer:** root `@pie/app` exports only; `ipcRenderer` confined
  to preload.

## Recommended priority

1. **P2 — vendored UI** (pie-audit-1, then -2, -3) before the next coss registry
   refresh.
2. **P2 — boundary lint + sessionRef** (pie-audit-4 through -6) — in [#9](https://github.com/oxwen11/pie/pull/9).
3. **P2 — composition tests** (pie-audit-10, -11) for Pi runtime, not a harness
   registry graph.
4. **P2–P3 — SPA feature model** (pie-audit-7 through -9) as new panel types land;
   Review panel in [#10](https://github.com/oxwen11/pie/pull/10) is the pattern.
5. **P3 — export narrowing** (pie-audit-12, -13, -14) as incremental refactors.

## Method

Automated scan (import direction, barrel usage, `Layer.fresh`, feature
cross-imports, vendored-tree contents) plus manual spot-checks of Pi session
tests, content-panel registration, and desktop main-process imports.
