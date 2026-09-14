import type { SupportedMessagePort } from "@orpc/client/message-port";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { Cause, type Context, Effect, Option } from "effect";

import type { DesktopApplication } from "../application/desktop-application";
import { type DesktopRpcContext, makeDesktopRouter } from "./desktop-router";

export interface DesktopRpcServer {
  readonly attach: (port: SupportedMessagePort) => () => Promise<void>;
}

/** Expected oRPC errors and client cancels stay silent; defects still log. */
function isSilentDesktopRpcCause(cause: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(cause)) return true;
  if (Cause.hasDies(cause)) return false;
  const error = Cause.findErrorOption(cause);
  return Option.isSome(error) && error.value instanceof ORPCError;
}

// Expected `ORPCError`s travel the Effect failure channel (beta.35+ no longer
// lifts them to success before wrap). Client cancellations arrive as
// interrupt-only causes. oRPC applies `effect/context` inside the wrapper, so
// the trailing provide is what puts the composition root's Context behind the
// tap itself.
function makeWrapDesktopRpcEffect(rpcContext: Context.Context<never>) {
  return <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.tapCause((cause) =>
        isSilentDesktopRpcCause(cause) ? Effect.void : Effect.logError("desktop rpc failed", cause),
      ),
      Effect.provide(rpcContext),
    );
}

export function makeDesktopRpcServer(
  application: DesktopApplication["Service"],
  rpcContext: Context.Context<never>,
): DesktopRpcServer {
  const handler = new RPCHandler(makeDesktopRouter(application));
  const context: DesktopRpcContext = {
    "effect/context": rpcContext,
    "effect/wrap": makeWrapDesktopRpcEffect(rpcContext),
  };

  return {
    attach: (port) => {
      handler.upgrade(port, { context });
      return () => handler.close(port);
    },
  };
}
