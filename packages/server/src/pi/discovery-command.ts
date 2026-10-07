import * as NodeServices from "@effect/platform-node/NodeServices";
import { type Duration, Effect } from "effect";

import { PiTransportError } from "../harness/errors";
import { PI_PROJECT_PROCESS_ARGS } from "./project-resource-policy";
import type { RpcCommand } from "./protocol";
import { resolvePiExecutable } from "./resolve-executable";
import { makePiTransport, type PiTransportFailure } from "./transport";

/** Bounds a discovery request when an extension never finishes loading. */
export const PI_DISCOVERY_TIMEOUT: Duration.Input = "30 seconds";

/**
 * One RPC against a short-lived pie-pi-process. Timeout or interruption
 * closes the scope, which terminates the child.
 */
export const runPiDiscoveryCommand = <A>(options: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly command: RpcCommand;
  readonly timeout?: Duration.Input;
}): Effect.Effect<A, PiTransportFailure> =>
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* makePiTransport({
        executable: resolvePiExecutable(),
        cwd: options.cwd,
        args: PI_PROJECT_PROCESS_ARGS,
        env: { PI_CODING_AGENT_DIR: options.agentDir },
      });
      return yield* transport.command<A>(options.command);
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: options.timeout ?? PI_DISCOVERY_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new PiTransportError({
            operation: `${options.command.type}-timeout`,
            cause: new Error("Pi did not answer the discovery request in time"),
          }),
        ),
    }),
    Effect.provide(NodeServices.layer),
  );
