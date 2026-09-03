# Frontend state and routing

Derive, don't sync: no `useEffect` mirroring state between sources — compute it
at render with `useMemo`. Server state stays in TanStack Query, client state in
Zustand, and selections store an id, not the object.

`eslint-plugin-react-you-might-not-need-an-effect` enforces this, loaded as an
oxlint JS plugin (`jsPlugins` in `oxlint.config.mts`) with all nine rules at
`error`. `packages/ui/src/{components,hooks,ai-elements}/**` is exempt: those
files are vendored or ported from upstream (`docs/adr/0001`), so a fix there is
discarded on the next refresh and belongs upstream instead. A host-pushed value
is a `useSyncExternalStore` source, not an effect — give the feed a
`getSnapshot` (`ServerStatusFeed` is the shape to copy) rather than mirroring it
into `useState`. `pie/no-restricted-disable` forbids `eslint-disable` /
`oxlint-disable` comments on these nine rules and on `react/exhaustive-deps`
(`react-hooks/exhaustive-deps` too): rewrite the effect or the store instead of
silencing the diagnostic. A blanket `eslint-disable` is the same violation.

## Where a file goes

`apps/app/src/features/<feature>/` holds everything one feature needs —
components, hooks, and its own non-React runtime alike. `features/chat/` is the
shape to copy: `components/` for its UI, `runtime/` for the Chat/ChatManager
machinery, `harness/` for the pure config resolvers, `claude-code/` + `codex/`
for per-agent tool rendering.

- **Features never import each other.** `@/features/a/…` inside `features/b/`
  is the one import this app forbids; `grep -rn 'from "@/features/' features`
  should never show a name crossing to a different one. When two features have
  to meet, the need travels up as a prop: the session route resolves `cwd`
  through `useProject` and hands it to `Chat`, rather than chat reaching into
  projects.
- **Only composition roots may combine features**: `routes/`,
  `app-interface.tsx`, and the app shell in `components/layout/`. Those four
  files are the whole allow-list today. `routes/__root.tsx` is the shell's one
  route-identity seam for the card: it reads the authoritative session-route
  loader ref and binds the card heading and `ContentPanelSessionProvider`.
  Sidebar modules (`AppSidebar` and the project/schedule entries it composes)
  read the route and navigate themselves — do not thread route callbacks or
  active flags into them. `AppShell` owns `SidebarProvider`, its viewport wrapper, and
  sidebar persistence because those are shell implementation details; the
  session-bound content provider is composed beneath it around `AppShellBody`.
  The body stays structural through `AppShellSidebar`/`AppShellMain` children;
  child components are composed as JSX children and consume shared layout state
  from the shell context. Never pass them through named props, attach them as
  static properties, or inspect `children` to extract slots. `CardPanel` receives
  display primitives and no shell component interprets routes or Project state.
- **`components/` is for what no single feature owns** — the shell
  (`layout/`) and generic pieces (`loader.tsx`). Base and composite UI belongs
  in `@getpie/ui`, not here.
- **The root export (`index.ts`) is the desktop seam.** `AppInterface`,
  `PlatformProvider`, `ServerStatusOverlay` and the platform types live at
  `src/` top level because `apps/desktop` mounts them; they are not features and
  must not be moved into one.
- There is no `core/`. It existed without a written rule, accumulated both pure
  runtime and `.tsx` components, and was dissolved into the above — don't
  reintroduce it as a home for "shared" code. A hook used by exactly one
  component sits next to that component.

- **Query keys come from `orpcQueryUtils.<router>.<proc>`.** Write cache with
  `queryOptions({input}).queryKey`; `.key()` omits the `type:"query"` segment, so
  using it for `setQueryData` silently writes a cache the UI never reads. `.key()`
  is for prefix operations (`invalidateQueries`, `setQueryDefaults`) only.
- **Do not wrap a bare `useQuery` in a hook.** Call `useQuery` /
  `useQueries` at the consumer. A hook is justified only when it owns extra
  state, a mutation, or a multi-query policy (`useProjects`,
  `useProjectSessionTitle`, `useDraftWorktree`, `useSessionModels`). This is a
  review judgment, not a lint rule — "thin" is semantic.
- **Query cache policy lives on the QueryClient** in `createAppClients`:
  `staleTime: Infinity`, `refetchOnWindowFocus: "always"`. Do not repeat those
  two literals on individual `useQuery` calls. A call site may still set its
  own capabilities: `select`, `enabled`, `retry`, `placeholderData`, or a cache
  option that actually differs (`staleTime: 30_000`,
  `refetchOnWindowFocus: false`). The one key-wide exception is
  `agent.session.list` (`staleTime: 30_000` via `setQueryDefaults`). Enforced
  by `pie-query/no-query-client-default-overrides`
  (`tools/oxlint/query-policy.ts`).
- **Narrow a query with `select`, not after the result.** When a consumer needs
  one field out of a list query, derive it inside `useQuery`'s `select` —
  narrowing after the fact (`data?.find(...)`) subscribes the component to the
  whole list. A `select` that closes over a prop must be memoised
  (`select: useCallback(fn, [dep])`) or it re-runs every render and loses
  referential stability; say so in a comment so nobody "simplifies" the
  `useCallback` away.
- Zustand here is not a global store: each `Chat` instance creates its own vanilla
  store as the AI SDK `ChatState`. `ChatManager` caches Chat instances by the
  complete `SessionRef` so transcripts survive navigation without crossing
  project/harness identity, and is constructed at App mount (module scope has no
  host connection yet).
- Content-panel tabs, live instances, provider bindings, and panel handles use
  the complete `SessionRef`; shell state is never keyed by a bare sessionId.
  The app-lifetime host registers unconditional panel definitions beside its
  construction. A definition whose availability is genuinely conditional must
  register with lifecycle at the boundary that owns that condition. Content-panel
  persistence is disposable client state: do not add storage versions or
  migrations. An incompatible shape may be discarded.
- `useSessionListSync` is the only consumer of the global event firehose; session
  events (chunks, requests) belong to the per-session chat transport.
- The live stream has no replay: subscribe before `agent.session.prompt`, and recover
  from a drop with `getSnapshot` + `seq > cursor`, not by replaying.
  `session.turn.started` is never re-sent — a turn present in the snapshot counts
  as started.
- `createFileRoute("/draft")` needs a literal path — a variable breaks the router
  plugin's auto code splitting. `routeTree.gen.ts` regenerates only when the Vite
  router plugin runs, not on typecheck: after adding or renaming routes, load the
  app root once before typechecking.
- The root `Outlet` must not be swapped on router `isLoading` — a same-route
  search change flips it, and remounting discards what the user has typed.
