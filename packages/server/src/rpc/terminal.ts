import { terminalContract } from "@getpie/contract/terminal";
import { Effect } from "effect";

import { TerminalNotRunning, TerminalSpawnFailed } from "../errors";
import { TerminalManager } from "../terminal";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { resolveWorkspaceCwd } from "./resolve-workspace";
import { streamToAsyncGenerator } from "./stream";

const orpc = implement(terminalContract).$context<RpcContext>();

const mapTerminalErrors = (errors: {
  NOT_FOUND: (input: { message: string }) => unknown;
  SESSION_NOT_ACTIVE: (input: { message: string }) => unknown;
  INTERNAL: (input: { message: string }) => unknown;
}) =>
  Effect.catchTags({
    TerminalNotRunning: (error: TerminalNotRunning) =>
      Effect.fail(
        errors.SESSION_NOT_ACTIVE({
          message: `terminal ${error.terminalId} is not running in session ${error.sessionId}`,
        }),
      ),
    TerminalSpawnFailed: (error: TerminalSpawnFailed) =>
      Effect.fail(errors.INTERNAL({ message: `failed to spawn a shell in ${error.cwd}` })),
  });

export const terminalRouter = orpc.router({
  connect: orpc.connect.effect(function* ({ input, errors }) {
    const manager = yield* TerminalManager;
    const cwd = yield* resolveWorkspaceCwd({ ref: input.ref }).pipe(
      Effect.catchTags({
        SessionNotFound: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `session ${error.sessionId} not found` })),
        ProjectNotFound: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${error.projectId} not found` })),
        StoreReadError: (error) =>
          Effect.fail(errors.INTERNAL({ message: `session store read failed: ${error.file}` })),
      }),
    );
    const stream = yield* manager.connect({ ...input, cwd }).pipe(mapTerminalErrors(errors));
    return streamToAsyncGenerator(stream);
  }),
  write: orpc.write.effect(function* ({ input, errors }) {
    const manager = yield* TerminalManager;
    yield* manager.write(input.ref, input.terminalId, input.data).pipe(mapTerminalErrors(errors));
  }),
  resize: orpc.resize.effect(function* ({ input, errors }) {
    const manager = yield* TerminalManager;
    yield* manager
      .resize(input.ref, input.terminalId, input.cols, input.rows)
      .pipe(mapTerminalErrors(errors));
  }),
  close: orpc.close.effect(function* ({ input }) {
    const manager = yield* TerminalManager;
    yield* manager.close(input.ref, input.terminalId);
  }),
});

export type TerminalRouter = typeof terminalRouter;
