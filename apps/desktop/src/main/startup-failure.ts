import type { Config } from "effect";

import type { ProtocolRegistrationError } from "./electron/app-protocol";

/** Turn a typed shell startup failure into the user-facing error dialog body. */
export function formatStartupFailure(
  error: ProtocolRegistrationError | Config.ConfigError,
): string {
  if (error._tag === "ConfigError") {
    return `The desktop could not read its configuration.\n\n${error.message}`;
  }
  return `The desktop could not register its internal protocol.\n\n${error.message}`;
}
