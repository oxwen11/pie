# Frontend state and routing

## Correctness and integration

- Server state belongs in TanStack Query. Derive values instead of synchronizing
  duplicate copies with effects. Subscribe to external stores through
  `useSyncExternalStore`; keep local interaction state local. Store a selection's
  id and derive the current object from its source, rather than retaining a stale copy.
- Features live in `apps/app/src/features/`. Cross-feature imports and app-to-server
  imports are lint-restricted; combine features at routes, the app root, or shell.
  Keep Desktop's public app exports compatible.
- Write query cache entries with `orpcQueryUtils.<router>.<proc>`'s
  `queryOptions({ input }).queryKey`. `.key()` is a prefix for invalidation/defaults,
  not the key for `setQueryData`.
- Query defaults belong in `createAppClients`; override them only when a query
  differs. Lint rejects repeated `staleTime: Infinity` and
  `refetchOnWindowFocus: "always"` at call sites.
- Chat stores, live panel instances, and session-scoped caches use the full
  `SessionRef`, not a bare session id. Keep mutable state on its lifecycle owner,
  not at module scope. Panel definitions follow their owning host's lifecycle.
- `useSessionListSync` consumes collection events; per-session transports consume
  session events. Subscribe before prompting. Recovery uses `getSnapshot` and
  `seq > cursor`; the stream has no replay and does not resend turn-start events.
- Route paths in `createFileRoute` must be literals for code splitting. After
  adding/renaming routes, load Vite once to regenerate `routeTree.gen.ts` before
  typechecking. Do not replace the root `Outlet` on router loading state: doing
  so remounts the page and loses user input.
- Browser persistence changes follow [persistence.md](persistence.md). Do not
  mistake disposable layout state for permission to discard user data.

## Design defaults

- Colocate feature code; extract shared pieces when they have a clear owner.
  Follow the [compound-component pattern](ui-components.md#chosen-pattern-compound-components)
  for multi-part UI; keep hook extraction tied to actual reuse or ownership.
- Direct query calls are fine. Extract hooks when they clarify ownership or reuse
  meaningful behavior; do not require or prohibit a hook per query/selector.
- Prefer `select` when a consumer needs only part of a query result. Stabilize
  selectors or memoize expensive work when useful, not every derived expression.
- Use Zustand for shared client state when needed; `useState`/`useReducer` are
  appropriate for local state. Keep shell structure separate from domain logic;
  compose its parts as JSX children with shared state on the shell provider,
  rather than expanding a list of named component/render props.

## Task guides

[React checks](../skills/react-doctor/SKILL.md) ·
[Runtime performance](../skills/performance/SKILL.md) ·
[Read-only audit](../skills/improve-react/SKILL.md).
[Test pruning](../skills/prune-tests/SKILL.md) is user-invoked only.
