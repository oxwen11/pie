import "@orpc/experimental-effect/extensions/effect";
import { implement, os } from "@orpc/server";

/**
 * oRPC builders with `.effect()` registered. Import `implement` / `os`
 * from here so the official Effect extension loads once at initialization
 * instead of from every router file.
 */
export { implement, os };
