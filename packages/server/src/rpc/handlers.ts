import { RPCHandler as WsRPCHandler } from "@orpc/server/websocket";
import { Context, type Effect, Layer, ManagedRuntime, Option } from "effect";
import type { WebSocket } from "ws";

import { ResourceMonitoring, ResourceMonitoringDisabled } from "../observability/resources";
import { AgentRuntimeLayer } from "../runtime";
import type { RpcContext } from "./context";
import { router } from "./router";
import { makeRpcWrap } from "./wrap";

export type RpcRuntime = {
  readonly context: RpcContext;
  /**
   * Run an effect on the server's own runtime. `http/server.ts` is Promise-
   * shaped (node:http + ws + Vite share one server), so this is how the
   * Effect-native pieces it wires up — the UI handler — get their services
   * without a second composition root.
   */
  readonly run: <A, E>(effect: Effect.Effect<A, E, AgentRuntime>) => Promise<A>;
  readonly dispose: () => Promise<void>;
};

/** Everything `AgentRuntimeLayer` provides, as a requirement. */
type AgentRuntime = Layer.Success<typeof AgentRuntimeLayer>;

/** The process context is provided while constructing and running the graph. */
export async function createRpcRuntime(
  effectContext: Context.Context<never> = Context.empty(),
): Promise<RpcRuntime> {
  // `provideMerge`, not `mergeAll`: the process context carries the
  // observability loggers, and fibers forked while `AgentRuntimeLayer` is
  // building must see them. `mergeAll` leaves those forks on Effect's default
  // logger (OpenCode #34730).
  const resources = Option.getOrElse(
    Context.getOption(effectContext, ResourceMonitoring),
    () => ResourceMonitoringDisabled,
  );
  const runtime = ManagedRuntime.make(
    AgentRuntimeLayer.pipe(
      Layer.provide(Layer.succeed(ResourceMonitoring, resources)),
      Layer.provideMerge(Layer.succeedContext(effectContext)),
    ),
  );
  const context: RpcContext = {
    "effect/context": await runtime.runPromise(runtime.contextEffect),
    "effect/wrap": makeRpcWrap(effectContext),
  };
  let disposing: Promise<void> | undefined;
  return {
    context,
    run: (effect) => runtime.runPromise(effect),
    dispose: () => (disposing ??= runtime.dispose()),
  };
}

export function createWsRPCHandler(rpcContext: RpcContext) {
  // Errors are reported by `effect/wrap` on the context, which — unlike a
  // client interceptor — runs inside Effect and so can tell an interrupted
  // call from a failed one.
  const wsHandler = new WsRPCHandler<RpcContext>(router);

  return function upgrade(ws: WebSocket) {
    wsHandler.upgrade(ws, {
      context: rpcContext,
    });
  };
}

export { makeRpcWrap };
