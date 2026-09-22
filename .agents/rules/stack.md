# Runtime stack

Read for Effect, RPC, runtime composition, or platform integration. Versions and
pins come from `pnpm-workspace.yaml`; do not assume stable-library examples match.

## Compatibility constraints

- Effect is 4.x RC: `Schema` comes from `effect`, services use `Context.Service`,
  and CLI/process APIs live under `effect/unstable/`.
- oRPC uses a multiplexed WebSocket. Reconnect through the lazy factory so each
  attempt obtains a fresh `/api/ws-ticket`. Keep the Effect extension imports in
  server/contract `orpc.ts`; they provide `.effect()` and schema input/output support.
- `@getpie/contract` uses Effect Schema. Error-map data still needs
  `toStandardSchema`; `type<T>()` outputs are not runtime validation.
- Effect Stream conversion lives in `packages/server/src/rpc/stream.ts`.
  HTTP uses `NodeHttpServer.makeHandler`: oRPC owns the upgrade listener, so
  introducing a competing listener with `HttpServer.serve` breaks transport.
- TypeScript uses `es2022` and `noUncheckedIndexedAccess`; newer library methods
  such as `toSorted` are unavailable without a deliberate target change.

## Effects and lifetime

- In Effect-managed code, use platform services for disk, randomness, and child
  processes so dependencies, errors, and cleanup remain controllable. Native APIs
  are appropriate at boundaries those services do not model, such as detached
  processes, Electron, or raw WebSocket upgrades.
- Keep pure parsing and path operations synchronous unless the caller benefits
  from an Effect result. `node:path` and `node:os.homedir` do not need an adapter.
- Supply platform layers at composition roots. Existing service layers bind
  their platform dependencies so public methods do not require callers to
  rebuild the platform. Avoid accidental duplicate runtimes or resources.
- Reuse the same `EventBusLayer` reference for publishers and subscribers;
  Effect memoizes by reference, and `Layer.fresh` creates a separate bus.
- Preserve the process observability context when building the RPC runtime:
  `provideMerge` passes it into fibers created during layer construction;
  merely merging layers does not. Tests without log files use `Observability.discard`.
- Map platform failures to domain errors. File-not-found uses the typed
  `error.reason._tag === "NotFound"`, not an errno string. Executability checks
  currently use stat mode bits because `FileSystem.access` has no `X_OK`.

## Effect tests

Use the existing `@effect/vitest` setup. Shared platform layers are useful;
stateful services need per-test construction (`Layer.build` inside the test).
A helper that rebuilds a runtime on every call can accidentally lose state.
Use scoped resources for cleanup and `FileSystem.makeNoop` for injected failures.
Tests that poll real time need `excludeTestServices: true` rather than a frozen
TestClock. See server tests and [toolchain.md](toolchain.md) for runner setup.
