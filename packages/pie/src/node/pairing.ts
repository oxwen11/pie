import {
  type DaemonEndpoint,
  DaemonClientError,
  type DaemonHandle,
  DaemonProtocolUnsupportedError,
  issueDaemonBrowserPairing,
} from "@getpie/server/daemon";
import { Data, Effect } from "effect";

export class BrowserAccessRestartRequired extends Data.TaggedError("BrowserAccessRestartRequired")<{
  readonly message: string;
}> {}

export type BrowserPairing = {
  readonly handle: DaemonHandle;
  readonly pairing: { readonly url: string; readonly expiresInSeconds: number };
};

type IssueBrowserPairing = (
  endpoint: DaemonEndpoint,
) => Effect.Effect<
  { readonly url: string; readonly expiresInSeconds: number },
  DaemonClientError | DaemonProtocolUnsupportedError
>;

/** Pair through one already-resolved resident daemon handle. */
export const pairResidentDaemon = <E, R>(
  daemon: Effect.Effect<DaemonHandle, E, R>,
  issuePairing: IssueBrowserPairing = issueDaemonBrowserPairing,
): Effect.Effect<BrowserPairing, E | DaemonClientError | BrowserAccessRestartRequired, R> =>
  daemon.pipe(
    Effect.flatMap((handle) =>
      issuePairing(handle).pipe(Effect.map((pairing) => ({ handle, pairing }))),
    ),
    Effect.catchTag("DaemonProtocolUnsupportedError", () =>
      Effect.fail(
        new BrowserAccessRestartRequired({
          message:
            "The running Pie daemon is healthy but too old for browser access. Restart it manually, then try again.",
        }),
      ),
    ),
  );
