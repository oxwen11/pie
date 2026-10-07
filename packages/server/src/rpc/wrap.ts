import { ORPCError } from "@orpc/server";
import { Cause, Context, Effect, Option } from "effect";

/**
 * Wrap every `.effect()` procedure. The oRPC effect bridge applies
 * `effect/context` before this wrapper, so the wrapper must re-provide the
 * process context around its own failure tap and span.
 *
 * One function here instruments all ~25 procedures at once: no router file
 * knows about logging, and none can forget to.
 *
 * Declared `ORPCError`s travel the Effect failure channel (and historically
 * could appear as success values before beta.35). Log those as `rpc.error`.
 * Interrupt-only causes stay silent (client disconnected mid-call). Anything
 * else is a defect.
 *
 * The native span names the procedure for any configured tracer. The failure
 * tap writes the actionable local record, including the procedure and cause.
 */
export function makeRpcWrap(effectContext: Context.Context<never> = Context.empty()) {
  return <A, E>(effect: Effect.Effect<A, E>, options: { readonly path: ReadonlyArray<string> }) => {
    const procedure = options.path.join(".");
    return effect.pipe(
      Effect.tap((value) =>
        value instanceof ORPCError ? logDeclaredRpcError(procedure, value) : Effect.void,
      ),
      Effect.tapCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void;
        if (!Cause.hasDies(cause)) {
          const error = Cause.findErrorOption(cause);
          if (Option.isSome(error) && error.value instanceof ORPCError) {
            return logDeclaredRpcError(procedure, error.value);
          }
        }
        return Effect.logError("rpc procedure failed", cause).pipe(
          Effect.annotateLogs({ event: "rpc.failed", procedure }),
        );
      }),
      // Outside the tap so a failure is logged inside the span it failed in.
      Effect.withSpan(`rpc.${procedure}`),
      Effect.provide(effectContext),
    );
  };
}

function logDeclaredRpcError(procedure: string, error: ORPCError<string, unknown>) {
  const annotations = {
    event: "rpc.error" as const,
    procedure,
    code: error.code,
    ...(error.data !== undefined ? { data: error.data } : undefined),
  };
  return Effect.logWarning(error.message).pipe(Effect.annotateLogs(annotations));
}
