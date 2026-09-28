import { Data, Effect, Ref, Stream } from "effect";
import type { PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const COMMAND_TIMEOUT = "30 seconds";
const FORCE_KILL_AFTER = "2 seconds";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

class GitHubCliTimedOut extends Data.TaggedError("GitHubCliTimedOut") {}
class GitHubCliOutputTooLarge extends Data.TaggedError("GitHubCliOutputTooLarge") {}
class GitHubCliIoError extends Data.TaggedError("GitHubCliIoError")<{
  readonly phase: "spawn" | "stdout" | "stderr" | "exit";
}> {}

class GitHubCliExecutableMissing extends Data.TaggedError("GitHubCliExecutableMissing") {}

export type GitHubCliExecutionError =
  | GitHubCliTimedOut
  | GitHubCliOutputTooLarge
  | GitHubCliIoError
  | GitHubCliExecutableMissing;

interface GitHubCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const concatBytes = (chunks: ReadonlyArray<Uint8Array>, length: number): Uint8Array => {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const isMissingExecutable = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "NotFound" &&
  error.reason.module === "ChildProcess" &&
  error.reason.method === "spawn";

const spawnError = (error: PlatformError.PlatformError): GitHubCliExecutionError =>
  isMissingExecutable(error)
    ? new GitHubCliExecutableMissing()
    : new GitHubCliIoError({ phase: "spawn" });

const streamError =
  (phase: "stdout" | "stderr" | "exit") => (_error: PlatformError.PlatformError) =>
    new GitHubCliIoError({ phase });

export const executeGitHubCommand = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  cwd: string,
  args: ReadonlyArray<string>,
  program: "gh" | "git" = "gh",
): Effect.Effect<GitHubCliResult, GitHubCliExecutionError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make(program, args, {
            cwd,
            env: { GH_PROMPT_DISABLED: "1" },
            extendEnv: true,
            stdin: "ignore",
            forceKillAfter: FORCE_KILL_AFTER,
          }),
        )
        .pipe(Effect.mapError(spawnError));
      const totalBytes = yield* Ref.make(0);
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const collect = (
        chunks: Uint8Array[],
        phase: "stdout" | "stderr",
      ): Effect.Effect<void, GitHubCliOutputTooLarge | GitHubCliIoError> =>
        Stream.runForEach(child[phase], (chunk) =>
          Effect.gen(function* () {
            const accepted = yield* Ref.modify(totalBytes, (current) => {
              const next = current + chunk.byteLength;
              return next > MAX_OUTPUT_BYTES
                ? ([false, current] as const)
                : ([true, next] as const);
            });
            if (!accepted) yield* new GitHubCliOutputTooLarge();
            chunks.push(Uint8Array.from(chunk));
            if (phase === "stdout") stdoutBytes += chunk.byteLength;
            else stderrBytes += chunk.byteLength;
          }),
        ).pipe(Effect.catchTag("PlatformError", (error) => Effect.fail(streamError(phase)(error))));

      const results = yield* Effect.all(
        [
          collect(stdoutChunks, "stdout"),
          collect(stderrChunks, "stderr"),
          child.exitCode.pipe(Effect.mapError(streamError("exit"))),
        ],
        { concurrency: "unbounded" },
      );
      const decoder = new TextDecoder();
      return {
        exitCode: Number(results[2]),
        stdout: decoder.decode(concatBytes(stdoutChunks, stdoutBytes)),
        stderr: decoder.decode(concatBytes(stderrChunks, stderrBytes)),
      };
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: COMMAND_TIMEOUT,
      orElse: () => Effect.fail(new GitHubCliTimedOut()),
    }),
  );
