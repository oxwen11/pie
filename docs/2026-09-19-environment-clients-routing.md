# EnvironmentClients: layered `environmentId` routing

**Date:** 2026-09-19  
**Status:** accepted for implementation (PR #38 follow-up)  
**Context:** remote Environments. #38 half-wired multi-env clients; session system surfaces must hit the session’s daemon.  
**T3 analogue:** `EnvironmentRegistry.run(environmentId, …)` — pie keeps the idea, not Effect Atom.

## Invariant

Open session `{ environmentId, sessionId, projectId }` → agent / fs / git / pty / session-scoped PR RPCs all use that env’s daemon.

Catalog (sidebar, draft, schedules, list-sync) may stay local this slice.

## Decision

**Registry of stable per-env `AppClients`. Not oRPC `DynamicLink` as the app seam.**

| Layer               | Owns                                                                                                       | Does not own      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- |
| **L0 Connection**   | `resolveRemote(envId) → ServerConnection \| undefined` from SSH/platform snapshot; connection key          | sockets, React    |
| **L1 Client bag**   | existing `createAppClients` / `disposeAppClients` — one `PieClient` + `QueryClient` + utils per connection | env lookup        |
| **L2 Registry**     | `Map<envId, { connectionKey, clients }>`; `get` / `prune`                                                  | panel/chat policy |
| **L3 Session bind** | SessionBound wraps Chat **and** Outlet; `useAppClients()` under that provider                              | catalog sidebar   |

oRPC stays ordinary: one `WebSocketRPCLink` per env (lazy connect + reconnect).  
`DynamicLink` would only re-implement L2 behind a single client handle; TanStack Query still needs per-env QC or utils `prefix`, and chat/pty want a stable client for the session lifetime. Skip that shell.

Routing truth: **`registry.get(environmentId)`**. Provider is sugar inside SessionBound.

```
UI(session) → L3 bind → L2.get(envId) → L1 AppClients → L0 connection → daemon
catalog UI  → L2.get(localId)  (same registry, local only)
```

## Minimal API

One module: `apps/app/src/lib/environment-clients.ts`.

```ts
type EnvironmentClients = {
  get(environmentId: string): AppClients; // sync; unknown → throw
  prune(
    live: ReadonlyMap<string, ServerConnection>,
    onDrop?: (environmentId: string) => void,
  ): void;
};

function createEnvironmentClients(input: {
  localId: string;
  local: AppClients;
  resolveRemote: (environmentId: string) => ServerConnection | undefined;
}): EnvironmentClients;
```

`get` rules: local identity; remote cache-by-key (http+token); miss → mint; missing remote → throw (no local fallback).

React: registry on router context. SessionBound wraps Main + content panel. Catalog uses `useLocalAppClients()`. No second React registry channel.

No second `clientsFor(): Promise`. No router-level duplicate Map.

## Tree

```
ChatManager(transport = registry.get(env))
Router({ environmentClients, localEnvironmentId })
  SessionBound(esr) → AppClientsProvider → Chat (Main) + ContentPanelOutlet
  Sidebar → useLocalAppClients()  (outer local QC)
```

Prune (owner next to registry create — today’s `app-interface` effect):

```
remote gone | connectionKey changed →
  registry.prune(liveConnections, (env) => {
    chatManager.forgetEnvironment(env)
    contentPanel.forgetAllForEnvironment(env)
  })
```

## Identity (same change set as bind)

`PanelHandle.sessionRef` / `onClose` → `EnvironmentSessionRef` (`{ environmentId, ref }`).  
Wire edge: `.ref`. Terminal register closes over `environmentClients` for `onClose`; view uses SessionBound `useAppClients`.

## Call sites (session plane only)

| Site                           | Change                                      |
| ------------------------------ | ------------------------------------------- |
| Chat transport                 | `registry.get(env)` + `sessionRef.ref`      |
| files / review / PR / terminal | SessionBound `useAppClients()` + `.ref`     |
| sidebar / draft / schedules    | `useLocalAppClients()`                      |
| terminal `onClose`             | `environmentClients.get(env)` at close time |
| SessionBound                   | wrap Main + Outlet; sync get                |
| loader                         | `registry.get(env)`                         |

## Ship

| Slice               | Work                                                                                                                                        | Proof                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **registry + tree** | `EnvironmentClients`; ESR; SessionBound wraps Chat+Outlet; catalog `useLocalAppClients`; terminal on session clients; env-wide panel forget | unit + typecheck     |
| **runtime**         | SSH remote Files/Terminal on tunnel port                                                                                                    | `pie-verify desktop` |

## Acceptance

1. SSH remote session → Files `fs`/`git` on tunnel port, not local daemon.
2. Same session Terminal pty open/close on tunnel port.
3. Local session → local daemon port.
4. Remove remote → clients disposed, no requests to dead tunnel.

Evidence: `pie-verify desktop` + PR screenshots/video.

## Non-goals

- `DynamicLink` / single shared `PieClient` with per-call `context.environmentId`
- Effect Atom / T3 command families
- Wire `{ environmentId, input }` on every RPC
- Remote sidebar / Connections switcher
- Serve allow-host / IPv6 / Host substring

## Success

- Session system I/O only via `registry.get(environmentId)` (or SessionBound / Outlet `useAppClients`).
- Layers stay separate: connection resolve ≠ client mint ≠ React bind.
- Acceptance passes on one real SSH remote.
