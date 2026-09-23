# Architecture

## Package boundaries

Dependencies flow from app/runtime packages toward shared leaves, not back:
`core ← server|cli|desktop`, `contract ← server ← cli|desktop`,
`contract ← client ← app ← desktop`.

| Location | Responsibility |
| --- | --- |
| `packages/core` | Shared process/build primitives; no runtime/app dependencies |
| `packages/contract` | Shared wire vocabulary and Effect schemas; no runtime/app dependencies |
| `packages/server` | Domain services, Pi runtime, RPC, HTTP/WS, daemon |
| `packages/client` | Typed oRPC WebSocket client |
| `packages/ui` | Shared UI; import through package subpaths |
| `packages/ssh` | SSH launch and loopback tunnels; no Electron, renderer, or oRPC |
| `packages/tailscale` | Discovery/Serve integration; no Electron, renderer, or oRPC; never log CLI stderr |
| `apps/app` | SPA, also mounted by Desktop through its public root exports |
| `apps/desktop` | Electron host; read its [AGENTS.md](../../apps/desktop/AGENTS.md) before editing |
| `packages/pie` | Product CLI (`pie`); delegates runtime to the server |
| `tools/` | Build, lint, and verification tooling, not product runtime |

The app uses client/contract, not server imports. HTTP security and transport
belong to the server, not a second implementation in the CLI. Respect package
exports and existing ownership; internal module decomposition is a design choice.
Keep leaf helpers private by default and expose only what callers need; internal
extraction does not require expanding a package's public surface.

## Session invariants

- Pi is the only agent. `SessionRef` is `{ projectId, sessionId }`; Pi receives
  `cwd`, not `projectId`. Do not add a harness registry or agent selector on the wire.
- `PiAgentSessionManager` owns one live session per ref and calls
  `PiAgent.create`/`resume`. Observing a session does not itself start a process.
- `PiAgentSessionService` owns orchestration, native-id translation, metadata,
  validation, and collection events. The RPC router resolves workspace context
  and maps errors; avoid duplicating that domain logic there.
- `packages/server/src/rpc/runtime.ts` composes the runtime. Session code lives
  under `packages/server/src/harness/`; the directory name is legacy, not support
  for multiple agents. Layer lifetime constraints are in [stack.md](stack.md).

Read [CONTEXT.md](../../CONTEXT.md) for domain names and [ADRs](../../docs/adr/)
for settled decisions. Streaming changes also require the
[streaming map](../../docs/wayfinder/session-streaming-refactor/map.md).

## Specialized ownership

- Host writes and stored data: [persistence.md](persistence.md), before design.
- Vendored versus local UI: [ui-components.md](ui-components.md).
- Skills have one source in `.agents/skills/`; client-specific skill directories
  use relative symlinks, not independent copies.
