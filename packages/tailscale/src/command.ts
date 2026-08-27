import os from "node:os";
import path from "node:path";

import { Duration, Effect, FileSystem, Option, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  TailscaleClientMissingError,
  TailscaleCommandError,
  type TailscaleStderrDiagnostic,
} from "./errors";

export const TAILSCALE_STATUS_TIMEOUT_MS = 1_500;
export const TAILSCALE_SERVE_TIMEOUT_MS = 10_000;

export type TailscaleClientAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly message: string };

export type FindTailscaleCommandOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
};

export type TailscaleCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

const isRunnableTailscale = (
  fs: FileSystem.FileSystem,
  candidate: string,
  platform: NodeJS.Platform,
): Effect.Effect<boolean> =>
  fs.stat(candidate).pipe(
    Effect.map(
      (info) => info.type === "File" && (platform === "win32" || (info.mode & 0o111) !== 0),
    ),
    Effect.catch(() => Effect.succeed(false)),
  );

export function tailscaleCommandForPlatform(platform: NodeJS.Platform = os.platform()): string {
  return platform === "win32" ? "tailscale.exe" : "tailscale";
}

export function tailscaleClientMissingMessage(
  command: string = tailscaleCommandForPlatform(),
): string {
  return `Tailscale client not found (${command}). Install Tailscale, ensure it is on PATH, and restart pie.`;
}

/** PATH lookup only — spawn uses the same search, so extra dirs would lie. */
export const findTailscaleCommand = (
  input: FindTailscaleCommandOptions = {},
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const platform = input.platform ?? os.platform();
    const env = input.env ?? process.env;
    const command = tailscaleCommandForPlatform(platform);
    const fs = yield* FileSystem.FileSystem;
    if (path.isAbsolute(command)) {
      return (yield* isRunnableTailscale(fs, command, platform)) ? command : undefined;
    }
    for (const dir of (env["PATH"] ?? "").split(pathDelimiter(platform))) {
      if (!dir) continue;
      const candidate = path.join(dir, command);
      if (yield* isRunnableTailscale(fs, candidate, platform)) return candidate;
    }
    return undefined;
  });

export const requireTailscaleCommand = (
  input: FindTailscaleCommandOptions = {},
): Effect.Effect<string, TailscaleClientMissingError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const platform = input.platform ?? os.platform();
    const command = tailscaleCommandForPlatform(platform);
    const found = yield* findTailscaleCommand(input);
    if (found === undefined) {
      return yield* new TailscaleClientMissingError({
        command,
        message: tailscaleClientMissingMessage(command),
      });
    }
    return command;
  });

export const probeTailscaleClient = (
  input: FindTailscaleCommandOptions = {},
): Effect.Effect<TailscaleClientAvailability, never, FileSystem.FileSystem> =>
  requireTailscaleCommand(input).pipe(
    Effect.map((): TailscaleClientAvailability => ({ available: true })),
    Effect.catchTag("TailscaleClientMissingError", (error) =>
      Effect.succeed({
        available: false,
        message: error.message,
      } satisfies TailscaleClientAvailability),
    ),
  );

export function isTailscaleSpawnNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  if ("code" in cause && cause.code === "ENOENT") return true;
  if ("reason" in cause && cause.reason === "NotFound") return true;
  if ("cause" in cause) return isTailscaleSpawnNotFound(cause.cause);
  return false;
}

const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/iu, "no-existing-handler"],
  [/not logged in|logged out|needs? login/iu, "not-logged-in"],
  [/permission denied|access denied|must be root|operation not permitted/iu, "permission-denied"],
];

/** Classifies stderr into a safe label. Never return or log the raw text. */
export function stderrDiagnosticOf(stderr: string): TailscaleStderrDiagnostic | undefined {
  if (stderr.trim().length === 0) return undefined;
  return STDERR_DIAGNOSTIC_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown";
}

export function tailscaleExitUserMessage(
  diagnostic: TailscaleStderrDiagnostic | undefined,
): string {
  switch (diagnostic) {
    case "not-logged-in":
      return "Tailscale is not logged in. Run tailscale up and try again.";
    case "permission-denied":
      return "Tailscale Serve needs permission. Check the Tailscale app and try again.";
    case "no-existing-handler":
      return "Tailscale HTTPS is not enabled.";
    case "unknown":
    case undefined:
      return "Tailscale command failed.";
    default: {
      const exhaustive: never = diagnostic;
      return exhaustive;
    }
  }
}

function missingTailscaleClientError(command: string): TailscaleClientMissingError {
  return new TailscaleClientMissingError({
    command,
    message: tailscaleClientMissingMessage(command),
  });
}

const collectProcessOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runTailscaleCommandInScope = (
  args: ReadonlyArray<string>,
  commandScope: Scope.Scope,
): Effect.Effect<
  TailscaleCommandResult,
  TailscaleCommandError | TailscaleClientMissingError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const command = yield* requireTailscaleCommand();
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const argv = [command, ...args];
    yield* Effect.logDebug("tailscale.command.start").pipe(
      Effect.annotateLogs({
        command: argv,
      }),
    );
    const child = yield* spawner
      .spawn(
        ChildProcess.make(command, args, {
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, commandScope),
        Effect.mapError((cause) =>
          isTailscaleSpawnNotFound(cause)
            ? missingTailscaleClientError(command)
            : new TailscaleCommandError({
                command: argv,
                exitCode: null,
                message: "Failed to run Tailscale.",
                cause,
              }),
        ),
      );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectProcessOutput(child.stdout),
        collectProcessOutput(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TailscaleCommandError({
            command: argv,
            exitCode: null,
            message: "Failed to read Tailscale output.",
            cause,
          }),
      ),
    );

    if (exitCode !== 0) {
      const stderrDiagnostic = stderrDiagnosticOf(stderr);
      yield* Effect.logWarning("tailscale.command.failed").pipe(
        Effect.annotateLogs({
          command: argv,
          exitCode,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          stderrDiagnostic: stderrDiagnostic ?? "none",
        }),
      );
      const commandError = {
        command: argv,
        exitCode,
        message: tailscaleExitUserMessage(stderrDiagnostic),
        stderrLength: stderr.length,
      };
      if (stderrDiagnostic === undefined) {
        return yield* new TailscaleCommandError(commandError);
      }
      return yield* new TailscaleCommandError({
        ...commandError,
        stderrDiagnostic,
      });
    }

    yield* Effect.logDebug("tailscale.command.succeeded").pipe(
      Effect.annotateLogs({ command: argv }),
    );
    return { stdout, stderr };
  });

export const runTailscaleCommand = (
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Effect.Effect<
  TailscaleCommandResult,
  TailscaleCommandError | TailscaleClientMissingError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.scopedWith((commandScope) => runTailscaleCommandInScope(args, commandScope)).pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap((result) =>
      Option.match(result, {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(
            new TailscaleCommandError({
              command: ["tailscale", ...args],
              exitCode: null,
              message: `Tailscale timed out after ${timeoutMs}ms.`,
            }),
          ),
      }),
    ),
  );
