import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { toStandardSchema } from "@orpc/experimental-effect";

/**
 * Contract builder with the official Effect Schema `.input` / `.output`
 * overloads. Import this `oc` (not `@orpc/contract`'s) so the desktop
 * contract can pass Effect Schema directly.
 *
 * Error-map `data` is not patched by the extension — convert those with
 * {@link toStandardSchema}.
 */
export { oc, toStandardSchema };
