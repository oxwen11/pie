import "@orpc/experimental-effect/extensions/effect";
import { implement } from "@orpc/server";

/**
 * Desktop oRPC builder with `.effect()` registered. Import `implement`
 * from here so the official Effect extension loads once at initialization.
 */
export { implement };
