# Environment RPC routing

**Status:** accepted and implemented on `feat/environment-clients-routing`
**Context:** every local or SSH daemon has a persistent UUID from `/api/environment`.

## Invariant

For `{ environmentId, ref }`, agent, files, Git, terminal, project, session, schedule, and pull-request RPCs must all target that Environment's daemon.

The UI does not select URLs, tokens, tunnels, or query-key prefixes.

## Runtime shape

```text
EnvironmentRpc
├── one TanStack QueryClient
├── one oRPC DynamicLink
├── links: Map<environmentId, WebSocket ClientLink>
├── orpc: Map<environmentId, prefixed EnvironmentOrpc>
└── EnvironmentCatalog workers
    └── Map<environmentId, AbortController>
```

`EnvironmentRpc.for(environmentId)` returns the only application RPC surface:

```ts
const orpc = environmentRpc.for(environmentId);

await orpc.agent.session.prepare.call({ ref });
useQuery(orpc.project.list.queryOptions());
```

Each cached oRPC proxy is stateless. Its client interceptor adds the immutable `environmentId` to every direct, query, mutation, and streaming call. `DynamicLink` reads that operation-local context and resolves the current WebSocket link. TanStack's native `prefix: environmentId` isolates identical procedures in the shared cache.

There is no mutable current Environment, per-Environment `QueryClient`, per-Environment transport client, or separate `rpc` facade.

## Connection lifecycle

The Environment feed is authoritative for connected remotes.

- **Add:** upsert the remote link, create its prefixed oRPC surface lazily, then start catalog hydration and session synchronization.
- **Rotate URL/token:** replace the link entry. Existing oRPC objects remain stable; subsequent calls resolve the new link.
- **Remove:** abort the Environment worker and session surfaces, forget its chats/panels, remove the link and prefixed cache, and fail later calls closed.
- **Race:** `for(environmentId)` may resolve a remote directly from the latest feed snapshot, so React observing the new Environment before the orchestration subscriber is safe.

The daemon UUID—not SSH alias, hostname, project, or session—is the routing and cache identity.

## Proactive catalog synchronization

Each connected Environment owns one worker. It opens the global session stream before fetching the baseline, then:

1. fetches `project.list`;
2. fetches active `agent.session.list` for every project;
3. applies session events to that Environment's prefixed list keys;
4. retries the stream with backoff until removed.

Session-event invalidation refetches inactive prefetched entries as well as mounted queries. The sidebar therefore does not need to be opened before a newly added Environment begins loading Projects and Sessions.

## React and non-React consumers

React may use `EnvironmentOrpcProvider` as a convenience binding around an already selected `EnvironmentOrpc`.

Non-React consumers use the same registry directly:

- router loaders: `environmentRpc.for(environmentId)`;
- ChatManager: Environment-bound session procedures;
- Terminal: Environment-bound direct calls and streams;
- catalog/session synchronization: one worker per connected Environment.

Provider remounting is not a routing mechanism. The global `QueryClient` never changes.

## Verification

Required coverage:

1. local and remote procedure keys have different daemon UUID prefixes;
2. calls through cached Environment surfaces select the matching DynamicLink;
3. concurrent calls to different Environments cannot cross-route;
4. URL/token rotation retains the Environment oRPC object while changing its link;
5. removal preserves local cache, removes only the departed prefix, and fails closed;
6. adding an Environment proactively requests projects and sessions;
7. Chat, Files, Git, Terminal, loaders, and session subscriptions use the session Environment.
