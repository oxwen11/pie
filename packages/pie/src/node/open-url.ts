import { Data, Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export type OpenUrlCommand = {
  readonly file: string;
  readonly args: readonly string[];
};

export class OpenUrlError extends Data.TaggedError("OpenUrlError")<{
  readonly message: string;
}> {}

export function systemOpenCommand(url: string, platform: NodeJS.Platform): OpenUrlCommand {
  if (platform === "darwin") return { file: "open", args: [url] };
  if (platform === "win32") return { file: "cmd.exe", args: ["/c", "start", "", url] };
  return { file: "xdg-open", args: [url] };
}

export const openSystemUrl = (
  url: string,
  platform: NodeJS.Platform = process.platform,
): Effect.Effect<void, OpenUrlError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const command = systemOpenCommand(url, platform);
      const handle = yield* spawner.spawn(
        ChildProcess.make(command.file, command.args, {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      const exitCode = yield* handle.exitCode;
      if (exitCode !== 0) {
        return yield* Effect.fail(
          new OpenUrlError({ message: "The system browser command was unsuccessful" }),
        );
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof OpenUrlError
        ? error
        : new OpenUrlError({ message: "Unable to launch the system browser" }),
    ),
    Effect.asVoid,
  );
